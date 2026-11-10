using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

public static class ChordPractice
{
    static readonly object Sync=new();
    static readonly SemaphoreSlim Microphone = new(1, 1);
    static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){WriteIndented=true};
    static string Root=>Environment.GetEnvironmentVariable("GUITAR_CHORD_PRACTICE")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"GuitarPracticeLab","chord-practice");
    static string ResultsFile=>Path.Combine(Root,"results.json");
    static Session? current;
    public sealed record StartRequest(string First,string Second,string Device="default",double Sensitivity=.003);
    public sealed record Result(Guid Id,string First,string Second,DateTimeOffset Finished,int CorrectChords,int Changes,double Seconds,string Tuning="Standard E A D G B E");
    sealed record PairScores(int? Last, int? Best);
    sealed class Session(string first,string second,string device,double sensitivity) {
        public Guid Id=Guid.NewGuid();public OneMinuteRound Round=new(first,second);
        public string Device=device,Status="preparing",Error="";public double Sensitivity=sensitivity,Rms,Confidence;
        public PairScores Previous = new(null, null);
        public string? Detected;public bool Saved;public Result? Result;public Stopwatch Clock=new();
        public CancellationTokenSource Cancel=new();public TaskCompletionSource<bool> Ready=new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
    static object View(Session s)=>new {s.Id,s.Status,first=s.Round.First,second=s.Round.Second,target=s.Round.Target,
        correctChords=s.Round.Count,changes=s.Round.Changes,remaining=Math.Max(0,60-s.Clock.Elapsed.TotalSeconds),s.Rms,s.Confidence,s.Detected,s.Error,s.Saved,s.Result,previous=s.Status=="completed"?s.Previous:null};
    static List<Result> ReadResults()=>File.Exists(ResultsFile)?JsonSerializer.Deserialize<List<Result>>(File.ReadAllText(ResultsFile),Json)??throw new IOException("Invalid results file."):new();
    static PairScores Scores(List<Result> results, string first, string second)
    {
        var pair = results.Where(r =>
            (r.First == first && r.Second == second) ||
            (r.First == second && r.Second == first)).ToArray();
        return new(
            pair.OrderByDescending(r => r.Finished).FirstOrDefault()?.CorrectChords,
            pair.Max(r => (int?)r.CorrectChords));
    }
    static void Save(Session s) {
        if(s.Saved||s.Result is null)return;
        Directory.CreateDirectory(Root);var results=ReadResults();if(!results.Any(r=>r.Id==s.Id))results.Add(s.Result);
        var temp=ResultsFile+".tmp";File.WriteAllText(temp,JsonSerializer.Serialize(results,Json));File.Move(temp,ResultsFile,true);s.Saved=true;
    }
    public static void MapEndpoints(WebApplication app) {
        app.Lifetime.ApplicationStopping.Register(()=>{lock(Sync)current?.Cancel.Cancel();});
        var api=app.MapGroup("/api/chord-practice");
        api.AddEndpointFilter(async(context,next)=>{
            var request=context.HttpContext.Request;
            if(!HttpMethods.IsGet(request.Method)) {
                string origin=request.Headers.Origin.ToString();
                if(request.Headers["Sec-Fetch-Site"]=="cross-site"||(origin.Length>0&&!string.Equals(origin,request.Scheme+"://"+request.Host,StringComparison.OrdinalIgnoreCase)))
                    return Results.Json(new {message="Open this exercise from the app."},statusCode:403);
            }
            return await next(context);
        });
        api.MapGet("/history",()=>{
            try {lock(Sync)return Results.Ok(ReadResults().OrderByDescending(r=>r.Finished).Take(100));}
            catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){return Results.Problem("Saved results cannot be read. Your existing file has not been replaced.");}
        });
        api.MapGet("/scores",(string first,string second)=>{
            try { lock(Sync) return Results.Ok(Scores(ReadResults(), first, second)); }
            catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException)
            { return Results.Problem("Saved scores cannot be read."); }
        });
        api.MapGet("/active",()=>{lock(Sync)return Results.Ok(current is null?null:View(current));});
        api.MapGet("/devices",async()=>{
            try {
                var info=new ProcessStartInfo("arecord"){RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false};info.ArgumentList.Add("-L");
                using var process=Process.Start(info)!;var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();
                using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try {await process.WaitForExitAsync(timeout.Token);}catch(OperationCanceledException){process.Kill(true);throw new IOException("Audio device lookup timed out.");}
                string text=await output;_ = await error;
                var names=text.Split('\n').Where(n=>Regex.IsMatch(n,@"^(default$|sysdefault:CARD=|plughw:CARD=)")).Select(n=>n.Trim()).Distinct().ToList();
                if(!names.Contains("default"))names.Insert(0,"default");
                return Results.Ok(new{available=process.ExitCode==0,devices=names,message=process.ExitCode==0?"":"No ALSA microphone devices found."});
            }catch(Exception e)when(e is System.ComponentModel.Win32Exception||e is IOException){return Results.Ok(new{available=false,devices=new[]{"default"},message="Microphone capture needs alsa-utils and a connected Pi microphone."});}
        });
        api.MapPost("/listen", (HttpContext context, ListenRequest request) =>
            Listen(context, request.Device, app.Lifetime.ApplicationStopping));
        api.MapPost("/listen-chords", async (HttpContext context, ListenChordsRequest request) =>
        {
            if (request.Names is null || request.Names.Length is < 1 or > 128 ||
                request.Names.Any(name => string.IsNullOrWhiteSpace(name) || name.Length > 30) ||
                request.Shift is < -12 or > 12)
            {
                context.Response.StatusCode = 400;
                await context.Response.WriteAsJsonAsync(new { message = "Choose a song with a valid chord timeline." });
                return;
            }
            var candidates = SongChordAnalysis.Candidates(request.Names, request.Shift);
            if (candidates.Count == 0)
            {
                context.Response.StatusCode = 400;
                await context.Response.WriteAsJsonAsync(new { message = "No supported chords in this timeline." });
                return;
            }
            await Listen(context, request.Device, app.Lifetime.ApplicationStopping, chords: candidates);
        });
        api.MapPost("/record", (HttpContext context, ListenRequest request) =>
            Listen(context, request.Device, app.Lifetime.ApplicationStopping, recordSeconds: 65));
        api.MapPost("/record-loop", (HttpContext context, ListenRequest request) =>
            Listen(context, request.Device, app.Lifetime.ApplicationStopping, recordSeconds: GuitarLoops.MaxSeconds));
        api.MapPost("/start",async(StartRequest request,HttpContext context)=>{
            Session s;
            try {
                if(!ValidDevice(request.Device)||!double.IsFinite(request.Sensitivity)||request.Sensitivity<.0005||request.Sensitivity>.05)throw new ArgumentException("Invalid microphone settings.");
                lock(Sync){
                    if(current is {Status:"preparing" or "running"})return Results.Conflict(new{message="An exercise is already using the microphone."});
                    if(current is {Status:"completed",Saved:false})return Results.Conflict(new{message="Save the previous result before starting another round."});
                    s=new(request.First,request.Second,request.Device!,request.Sensitivity);
                    s.Previous=Scores(ReadResults(),s.Round.First,s.Round.Second);
                    current=s;
                }
                using var disconnected=context.RequestAborted.Register(()=>s.Cancel.Cancel());
                _=Task.Run(()=>Capture(s));
                await s.Ready.Task.WaitAsync(TimeSpan.FromSeconds(12));
                lock(Sync)return s.Status=="error"?Results.BadRequest(new{message=s.Error}):Results.Ok(View(s));
            }catch(ArgumentException e){return Results.BadRequest(new{message=e.Message});}
            catch(TimeoutException){lock(Sync){current?.Cancel.Cancel();}return Results.BadRequest(new{message="The microphone did not provide audio. Check its connection and selected device."});}
            catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){return Results.Problem("Result storage is unavailable. Existing results were not changed.");}
        });
        api.MapPost("/{id:guid}/cancel",(Guid id)=>{
            lock(Sync){if(current is null||current.Id!=id)return Results.NotFound();current.Cancel.Cancel();return Results.Ok(View(current));}
        });
        api.MapPost("/{id:guid}/save",(Guid id)=>{
            lock(Sync){
                if(current is null||current.Id!=id||current.Status!="completed")return Results.BadRequest(new{message="No completed result to save."});
                try{Save(current);current.Error="";return Results.Ok(View(current));}
                catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){return Results.Problem("Could not save. Keep this page open and try again.");}
            }
        });
    }
    public sealed record ListenRequest(string Device);
    public sealed record ListenChordsRequest(string Device, string[] Names, int Shift);

    static bool ValidDevice(string? device) =>
        Regex.IsMatch(device ?? "", @"^[a-zA-Z0-9_:,=.-]{1,160}$");

    static Process OpenMicrophone(string device)
    {
        var config = new ProcessStartInfo("arecord")
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false
        };
        foreach (var arg in new[] { "-q", "-D", device, "-t", "raw", "-f", "S16_LE", "-r", "16000", "-c", "1" })
            config.ArgumentList.Add(arg);
        return Process.Start(config) ?? throw new IOException("Could not start microphone capture.");
    }

    static async Task Listen(HttpContext context, string device, CancellationToken stopping, int recordSeconds = 0, List<GuitarChord>? chords = null)
    {
        if (!ValidDevice(device) || !Microphone.Wait(0))
        {
            context.Response.StatusCode = ValidDevice(device) ? 409 : 400;
            await context.Response.WriteAsJsonAsync(new { message = ValidDevice(device)
                ? "The microphone is in use. Stop the other exercise and try again."
                : "Choose a valid microphone." });
            return;
        }

        bool record = recordSeconds > 0;
        Process? process = null;
        Task<string>? errors = null;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);
        async Task Write(object value)
        {
            await context.Response.WriteAsync(JsonSerializer.Serialize(value) + "\n", lifetime.Token);
            await context.Response.Body.FlushAsync(lifetime.Token);
        }
        try
        {
            context.Response.ContentType = record ? "application/octet-stream" : "application/x-ndjson";
            context.Response.Headers.CacheControl = "no-store";
            process = OpenMicrophone(device);
            errors = process.StandardError.ReadToEndAsync();
            var detector = chords is null ? null : new ChordDetector();
            var window = new double[detector is null ? 4096 : ChordDetector.Size];
            var bytes = new byte[record ? 2048 : window.Length * 2];
            int recordingBytes = recordSeconds * 16000 * 2;
            int captured = 0;
            while (!lifetime.IsCancellationRequested && (!record || captured < recordingBytes))
            {
                using var read = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                read.CancelAfter(TimeSpan.FromSeconds(8));
                var buffer = bytes.AsMemory(0, record ? Math.Min(bytes.Length, recordingBytes - captured) : bytes.Length);
                await process.StandardOutput.BaseStream.ReadExactlyAsync(buffer, read.Token);
                if (record)
                {
                    await context.Response.Body.WriteAsync(buffer, lifetime.Token);
                    await context.Response.Body.FlushAsync(lifetime.Token);
                    captured += buffer.Length;
                    continue;
                }
                for (int i = 0; i < window.Length; i++)
                    window[i] = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i * 2, 2)) / 32768.0;
                if (detector is null) await Write(new { frequency = PitchTest.Detect(window) });
                else
                {
                    var (_, chroma) = detector.Measure(window, .004);
                    await Write(new { chord = chroma is null ? null : SongChordAnalysis.Match(chroma, chords!, live: true) });
                }
            }
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or System.ComponentModel.Win32Exception)
        {
            if (!lifetime.IsCancellationRequested)
            {
                const string message = "No microphone audio. Check the USB mic and the selected device.";
                if (!record) await Write(new { error = message });
                else if (context.Response.HasStarted) context.Abort();
                else
                {
                    context.Response.StatusCode = 503;
                    await context.Response.WriteAsJsonAsync(new { message });
                }
            }
        }
        finally
        {
            try { await CloseMicrophone(process, errors); }
            finally { Microphone.Release(); }
        }
    }

    static async Task CloseMicrophone(Process? process, Task<string>? errors)
    {
        if (process is null) return;
        using (process)
        {
            try { if (!process.HasExited) process.Kill(true); }
            catch (InvalidOperationException) { }
            await process.WaitForExitAsync();
            if (errors is not null) await errors;
        }
    }

    static async Task Capture(Session s) {
        Process? process=null;Task<string>? errors=null;
        bool acquired = Microphone.Wait(0);
        if (!acquired)
        {
            lock (Sync) { s.Status = "error"; s.Error = "The microphone is in use. Stop the other exercise and try again."; }
            s.Ready.TrySetResult(true);
            return;
        }
        try {
            var detector=new ChordDetector();var a=GuitarChord.Parse(s.Round.First);var b=GuitarChord.Parse(s.Round.Second);
            process=OpenMicrophone(s.Device);errors=process.StandardError.ReadToEndAsync();
            var bytes=new byte[ChordDetector.Size*2];var window=new double[ChordDetector.Size];
            using(var startup=CancellationTokenSource.CreateLinkedTokenSource(s.Cancel.Token)) {
                startup.CancelAfter(TimeSpan.FromSeconds(10));await process.StandardOutput.BaseStream.ReadExactlyAsync(bytes,startup.Token);
            }
            for(int i=0;i<window.Length;i++)window[i]=BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i*2,2))/32768.0;
            lock(Sync){if(s.Cancel.IsCancellationRequested)throw new OperationCanceledException();s.Status="running";s.Clock.Start();s.Ready.TrySetResult(true);}
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(s.Cancel.Token);deadline.CancelAfter(TimeSpan.FromSeconds(60));
            while(s.Clock.Elapsed.TotalSeconds<60) {
                s.Cancel.Token.ThrowIfCancellationRequested();
                var reading=detector.Analyze(window,a,b,s.Sensitivity);
                lock(Sync){s.Rms=reading.Rms;s.Detected=reading.Name;s.Confidence=reading.Confidence;s.Round.Observe(reading.Name,s.Clock.Elapsed.TotalSeconds);}
                try{await process.StandardOutput.BaseStream.ReadExactlyAsync(bytes.AsMemory(0,ChordDetector.Hop*2),deadline.Token);}
                catch(OperationCanceledException)when(!s.Cancel.IsCancellationRequested){break;}
                Array.Copy(window,ChordDetector.Hop,window,0,ChordDetector.Size-ChordDetector.Hop);
                for(int i=0;i<ChordDetector.Hop;i++)window[ChordDetector.Size-ChordDetector.Hop+i]=BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i*2,2))/32768.0;
            }
            lock(Sync){
                s.Cancel.Token.ThrowIfCancellationRequested();s.Clock.Stop();s.Status="completed";
                s.Result=new(s.Id,s.Round.First,s.Round.Second,DateTimeOffset.UtcNow,s.Round.Count,s.Round.Changes,60);
                try{Save(s);}catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){s.Error="Result not saved. Keep this page open and tap Retry save.";}
            }
        }catch(OperationCanceledException){lock(Sync){s.Clock.Stop();s.Status=s.Cancel.IsCancellationRequested?"cancelled":"error";if(s.Status=="error")s.Error="The microphone did not provide audio. Check the selected capture device.";}}
        catch(Exception e){
            string detail="";
            if(process is not null)try{if(!process.HasExited)process.Kill(true);if(errors is not null)detail=await errors;}catch{}
            lock(Sync){s.Clock.Stop();s.Status="error";s.Error="Microphone capture stopped. Check the microphone, ALSA device and audio permissions. "+(detail.Length>240?detail[..240]:detail);if(e is System.ComponentModel.Win32Exception)s.Error="Install alsa-utils on the Pi and connect a microphone before starting.";}
        }finally{
            try { await CloseMicrophone(process, errors); }
            finally { Microphone.Release(); s.Ready.TrySetResult(true); }
        }
    }
}
