using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

public static partial class SongLibrary
{
    public sealed record TimelineEdit(string AudioVersion, string? Variant,
        SongChordAnalysis Previous, SongChordAnalysis Analysis);

    static void MapTimeline(RouteGroupBuilder api)
    {
        api.MapPut("/{id:guid}/chord-timeline", (Guid id, TimelineEdit edit) => Guard(async () =>
        {
            var song = Read(id);
            var variant = edit.Variant ?? "";
            if (variant is not ("" or "simple")) throw new ArgumentException("Choose the standard or simple PDF.");
            var current = variant == "simple" ? CurrentSimpleAnalysis(song) : song.ChordAnalysis;
            if (current is null || edit.Previous is null || edit.AudioVersion != song.AudioFile ||
                JsonSerializer.Serialize(current, Json) != JsonSerializer.Serialize(edit.Previous, Json))
                return Results.Conflict(new { message = "This song or its analysis changed. Reopen the editor before saving." });
            var analysis = edit.Analysis;
            if (analysis is null || analysis.Shift != current.Shift || analysis.Changes is null ||
                analysis.Changes.Count is < 1 or > 10000 || analysis.Changes.Any(change => change is null ||
                    !double.IsFinite(change.Time) || change.Time < 0 || change.Time >= song.Duration ||
                    (change.Name is not null && (change.Name.Length > 30 || string.IsNullOrWhiteSpace(change.Name)))) ||
                analysis.Changes.Zip(analysis.Changes.Skip(1)).Any(pair => pair.First.Time >= pair.Second.Time))
                throw new ArgumentException("Chord starts must be in increasing order inside the song. Choose a valid chord name.");
            foreach (var change in analysis.Changes)
                if (change.Name is not null) GuitarChord.Parse(change.Name);
            analysis = analysis with { Corrected = true };
            if (variant == "simple") song.SimpleChordAnalysis = analysis;
            else song.ChordAnalysis = analysis;
            await Save(song);
            return Results.Ok(analysis);
        }));
        api.MapGet("/{id:guid}/waveform", (Guid id, double start, double end, HttpContext context) => Guard(async () =>
        {
            if(context.RequestAborted.IsCancellationRequested)return Results.StatusCode(499);
            var song = Read(id);
            if (string.IsNullOrEmpty(song.AudioFile)) throw new ArgumentException("Attach an MP3 first.");
            if (!double.IsFinite(start) || !double.IsFinite(end) || start < 0 || end <= start ||
                end > song.Duration + .1 || end-start > 20)
                throw new ArgumentException("Choose up to 20 seconds inside the song.");
            var info = new ProcessStartInfo("ffmpeg") {RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false};
            foreach (var argument in new[] {"-nostdin","-v","error","-ss",start.ToString(CultureInfo.InvariantCulture),
                "-i",Path.Combine(Folder(id),song.AudioFile),"-t",(end-start).ToString(CultureInfo.InvariantCulture),
                "-vn","-ac","1","-ar","4000","-f","s16le","pipe:1"}) info.ArgumentList.Add(argument);
            using var process = Process.Start(info) ?? throw new IOException("Could not read the waveform.");
            var errors = process.StandardError.ReadToEndAsync();
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            deadline.CancelAfter(TimeSpan.FromSeconds(15));
            using var output = new MemoryStream();
            try
            {
                await process.StandardOutput.BaseStream.CopyToAsync(output, deadline.Token);
                await process.WaitForExitAsync(deadline.Token);
                if (process.ExitCode != 0) throw new ArgumentException("Could not read this MP3 waveform.");
            }
            catch (OperationCanceledException) { if(context.RequestAborted.IsCancellationRequested)return Results.StatusCode(499);throw new ArgumentException("Waveform processing timed out."); }
            finally { if (!process.HasExited) process.Kill(true); _ = await errors; }
            var bytes = output.ToArray();
            var bins = new double[160];
            for (int index=0; index+1<bytes.Length; index+=2)
            {
                int bin = Math.Min(bins.Length-1, (int)((long)index*bins.Length/Math.Max(1,bytes.Length)));
                bins[bin] = Math.Max(bins[bin], Math.Abs(BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(index,2))/32768.0));
            }
            return Results.Ok(new {start,end,bins});
        }));
    }
}
