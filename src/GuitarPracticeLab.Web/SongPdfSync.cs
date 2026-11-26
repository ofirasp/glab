using System.Text.Json;
using System.Text.RegularExpressions;

public static partial class SongLibrary
{
    public sealed record PdfSyncEdit(JsonElement State);
    static void MapPdfSync(RouteGroupBuilder api)
    {
        string SyncPath(Guid id, string key)
        {
            if (!Regex.IsMatch(key, @"^guitar-auto-pdf-[a-zA-Z0-9-]{1,100}$"))
                throw new ArgumentException("Invalid PDF sync key.");
            return Path.Combine(Folder(id), key + ".json");
        }
        api.MapGet("/{id:guid}/pdf-sync", (Guid id, string key) => Guard(() =>
        {
            Read(id);
            var path = SyncPath(id, key);
            return Task.FromResult<IResult>(Results.Content(File.Exists(path) ? File.ReadAllText(path) : "null", "application/json"));
        }));
        api.MapPut("/{id:guid}/pdf-sync", (Guid id, string key, PdfSyncEdit edit) => Guard(async () =>
        {
            if (edit.State.ValueKind != JsonValueKind.Object || !edit.State.TryGetProperty("anchors", out var anchors)
                || anchors.ValueKind != JsonValueKind.Object || edit.State.GetRawText().Length > 500_000)
                throw new ArgumentException("Invalid PDF sync settings.");
            Read(id);
            var path = SyncPath(id, key);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { await File.WriteAllTextAsync(temporary, edit.State.GetRawText()); File.Move(temporary, path, true); }
            finally { File.Delete(temporary); }
            return Results.Ok(new { saved = true });
        }));
    }
}
