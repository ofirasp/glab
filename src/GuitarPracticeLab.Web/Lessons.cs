using System.Net;
using System.Text.Json;

public static class Lessons
{
    static readonly SemaphoreSlim Gate=new(1,1);
    static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web){WriteIndented=true};
    static string Lab=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"GuitarPracticeLab");
    static string Root=>Environment.GetEnvironmentVariable("GUITAR_LESSONS")??Path.Combine(Lab,"lessons");
    static string Bridge=>Environment.GetEnvironmentVariable("GUITAR_LESSON_BROWSER")??Path.Combine(Lab,"lesson-browser");
    static string FileName=>Path.Combine(Root,"links.json");
    public sealed class Lesson {
        public Guid Id{get;set;}=Guid.NewGuid();public string Title{get;set;}="";public string Url{get;set;}="";public string Notes{get;set;}="";
        public bool Archived{get;set;}public DateTimeOffset Updated{get;set;}=DateTimeOffset.UtcNow;
    }
    public sealed record Edit(string Title,string Url,string Notes="",bool PreserveExisting=false);
    public sealed record OpenRequest(string Url);
    public static string ValidateUrl(string? value,bool allowEmpty=false) {
        string text=(value??"").Trim();if(allowEmpty&&text.Length==0)return "";
        if(text.Length>2048||text.Any(char.IsControl)||!Uri.TryCreate(text,UriKind.Absolute,out var uri)||
            (uri.Scheme!="https"&&uri.Scheme!="http")||string.IsNullOrWhiteSpace(uri.Host)||!string.IsNullOrEmpty(uri.UserInfo))
            throw new ArgumentException("Use a complete http:// or https:// lesson link without login details in the address.");
        return uri.AbsoluteUri;
    }
    static List<Lesson> Read()=>File.Exists(FileName)?JsonSerializer.Deserialize<List<Lesson>>(File.ReadAllText(FileName),Json)??throw new IOException("Invalid saved lessons file."):new();
    static void Save(List<Lesson> items){Directory.CreateDirectory(Root);var temp=FileName+".tmp";File.WriteAllText(temp,JsonSerializer.Serialize(items,Json));File.Move(temp,FileName,true);}
    static bool Local(HttpContext context)=>context.Connection.RemoteIpAddress is { } ip&&IPAddress.IsLoopback(ip);
    static bool Available(out bool running,out string error){
        running=false;error="";
        try {using var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(Bridge,"status.json")));var root=doc.RootElement;
            double heartbeat=root.GetProperty("heartbeat").GetDouble();if(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000.0-heartbeat>6)return false;
            running=root.GetProperty("running").GetBoolean();error=root.GetProperty("error").GetString()??"";return root.GetProperty("available").GetBoolean();
        }catch(Exception e)when(e is IOException||e is JsonException||e is KeyNotFoundException||e is UnauthorizedAccessException){return false;}
    }
    static string? CaptureId(){
        try{using var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(Bridge,"status.json")));
            return doc.RootElement.TryGetProperty("captureId",out var id)&&id.GetString() is string value&&System.Text.RegularExpressions.Regex.IsMatch(value,@"^[a-p]{32}$")?value:null;
        }catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){return null;}
    }
    static Guid Command(string action,string url="",Guid? desktopSessionId=null){
        var id = Guid.NewGuid();
        Directory.CreateDirectory(Bridge);var temp=Path.Combine(Bridge,"request.json.tmp");
        File.WriteAllText(temp,JsonSerializer.Serialize(new{id,action,url,desktopSessionId,created=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000.0},Json));
        File.Move(temp,Path.Combine(Bridge,"request.json"),true);
        return id;
    }
    static bool KioskRequest(HttpContext context) =>
        Local(context) &&
        (context.Request.Host.Host is "127.0.0.1" or "localhost" or "[::1]");

    static JsonElement DesktopStatus()
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(Bridge, "status.json")));
            var status = document.RootElement;
            var age = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 - status.GetProperty("heartbeat").GetDouble();
            if (age < 0 || age > 6 || !status.TryGetProperty("desktopControls", out var enabled) ||
                enabled.ValueKind != JsonValueKind.True)
                return default;
            return status.Clone();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException or KeyNotFoundException)
        {
            return default;
        }
    }

    static async Task<IResult> RequestDesktopAction(HttpContext context, string action)
    {
        if (!KioskRequest(context) || context.Request.Headers.Origin != context.Request.Scheme + "://" + context.Request.Host)
            return Results.StatusCode(403);
        if (action is not ("poweroff" or "screen-sleep")) return Results.NotFound();
        var desktop = DesktopStatus();
        if (desktop.ValueKind != JsonValueKind.Object ||
            !desktop.TryGetProperty("desktopSessionId", out var sessionId) ||
            !sessionId.TryGetGuid(out var desktopSessionId))
            return Results.Json(new { message = "Restart the Pi to enable the desktop controls." }, statusCode: 503);

        Guid id;
        await Gate.WaitAsync(context.RequestAborted);
        try { id = Command(action, desktopSessionId: desktopSessionId); }
        finally { Gate.Release(); }

        for (var attempt = 0; attempt < 30; attempt++)
        {
            await Task.Delay(250, context.RequestAborted);
            var status = DesktopStatus();
            if (status.ValueKind != JsonValueKind.Object ||
                !status.TryGetProperty("desktopResult", out var result) || result.ValueKind != JsonValueKind.Object ||
                !result.TryGetProperty("id", out var requestId) || !requestId.TryGetGuid(out var completedId) ||
                completedId != id)
                continue;
            var error = result.GetProperty("error").GetString();
            return string.IsNullOrEmpty(error)
                ? Results.Ok()
                : Results.Json(new { message = error }, statusCode: 503);
        }
        return Results.Json(new { message = "The desktop did not confirm this request." }, statusCode: 503);
    }

    public static void MapEndpoints(WebApplication app){
        app.MapPost("/api/desktop/{action}", RequestDesktopAction);
        var api=app.MapGroup("/api/lessons");
        api.AddEndpointFilter(async(context,next)=>{
            var req=context.HttpContext.Request;
            if(!HttpMethods.IsGet(req.Method)){
                string origin=req.Headers.Origin.ToString();if(req.Headers["Sec-Fetch-Site"]=="cross-site"||(origin.Length>0&&!string.Equals(origin,req.Scheme+"://"+req.Host,StringComparison.OrdinalIgnoreCase)))return Results.Json(new{message="Open Lessons from the app before making changes."},statusCode:403);
            }
            await Gate.WaitAsync();try{return await next(context);}
            catch(ArgumentException e){return Results.BadRequest(new{message=e.Message});}
            catch(FileNotFoundException){return Results.NotFound(new{message="Saved lesson not found."});}
            catch(Exception e)when(e is IOException||e is JsonException||e is UnauthorizedAccessException){return Results.Problem("Lesson storage is unavailable. Existing saved links have not been replaced.");}
            finally{Gate.Release();}
        });
        api.MapGet("",()=>Results.Ok(Read().Where(l=>!l.Archived).OrderBy(l=>l.Title,StringComparer.OrdinalIgnoreCase)));
        api.MapPost("",(Edit edit)=>{
            string url=ValidateUrl(edit.Url);if(string.IsNullOrWhiteSpace(edit.Title)||edit.Title.Trim().Length>160||(edit.Notes??"").Length>10000)throw new ArgumentException("Add a title up to 160 characters and notes up to 10,000 characters.");
            var rows=Read();var item=rows.FirstOrDefault(l=>l.Url==url);
            if(item is not null&&edit.PreserveExisting){item.Archived=false;item.Updated=DateTimeOffset.UtcNow;Save(rows);return Results.Ok(item);}
            if(item is null){item=new();rows.Add(item);}item.Title=edit.Title.Trim();item.Url=url;item.Notes=edit.Notes??"";item.Archived=false;item.Updated=DateTimeOffset.UtcNow;Save(rows);return Results.Ok(item);
        });
        api.MapPut("/{id:guid}",(Guid id,Edit edit)=>{
            var rows=Read();var item=rows.FirstOrDefault(l=>l.Id==id&&!l.Archived)??throw new FileNotFoundException();
            string url=ValidateUrl(edit.Url);if(string.IsNullOrWhiteSpace(edit.Title)||edit.Title.Trim().Length>160||(edit.Notes??"").Length>10000)throw new ArgumentException("Check the title and notes length.");
            if(rows.Any(l=>l.Id!=id&&!l.Archived&&l.Url==url))throw new ArgumentException("That link is already saved. Edit the existing lesson instead.");
            item.Title=edit.Title.Trim();item.Url=url;item.Notes=edit.Notes??"";item.Updated=DateTimeOffset.UtcNow;Save(rows);return Results.Ok(item);
        });
        api.MapDelete("/{id:guid}",(Guid id)=>{var rows=Read();var item=rows.FirstOrDefault(l=>l.Id==id)??throw new FileNotFoundException();item.Archived=true;Save(rows);return Results.Ok(new{removed=true});});
        api.MapPost("/{id:guid}/restore",(Guid id)=>{var rows=Read();var item=rows.FirstOrDefault(l=>l.Id==id)??throw new FileNotFoundException();item.Archived=false;Save(rows);return Results.Ok(item);});
        api.MapGet("/browser",(HttpContext context)=>{
            bool available=Available(out bool running,out string error);return Results.Ok(new{available=Local(context)&&available,running=Local(context)&&running,error=Local(context)?error:"",captureId=Local(context)&&available?CaptureId():null});
        });
        api.MapPost("/browser/open",(HttpContext context,OpenRequest request)=>{
            if(!Local(context))return Results.Json(new{message="Use this computer's browser to watch lessons."},statusCode:403);
            string url=ValidateUrl(request.Url);if(!Available(out _,out var error))return Results.Json(new{message="Restart the Pi once after this update to enable lesson browsing. "+error},statusCode:503);
            Command("open",url);return Results.Ok(new{opening=true});
        });
        api.MapPost("/browser/return",(HttpContext context)=>{
            if(!Local(context))return Results.Json(new{message="This button returns the Pi's lesson window to practice."},statusCode:403);
            Command("close");return Results.Ok(new{returning=true});
        });
    }
}
