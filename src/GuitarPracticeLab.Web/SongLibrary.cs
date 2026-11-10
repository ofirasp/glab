using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.Features;

// Local library, stored outside the published application so upgrades preserve songs.
public static class SongLibrary
{
    static readonly SemaphoreSlim Gate = new(1, 1);
    static readonly SemaphoreSlim ChordAnalysisGate = new(1, 1);
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    static string Root => Environment.GetEnvironmentVariable("GUITAR_SONG_LIBRARY")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "GuitarPracticeLab", "song-library");
    static string Folder(Guid id) => Path.Combine(Root, id.ToString("N"));
    static string Metadata(Guid id) => Path.Combine(Folder(id), "song.json");
    static string Recordings => Environment.GetEnvironmentVariable("GUITAR_RECORDINGS_ROOT")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "GuitarPracticeLab", "recordings");
    static Song Read(Guid id) => File.Exists(Metadata(id))
        ? JsonSerializer.Deserialize<Song>(File.ReadAllText(Metadata(id)), Json) ?? throw new InvalidDataException("Invalid song metadata.")
        : throw new FileNotFoundException("Song not found.");
    static async Task Save(Song song)
    {
        song.Updated = DateTimeOffset.UtcNow;
        var temporary = Metadata(song.Id) + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(song, Json));
        File.Move(temporary, Metadata(song.Id), true);
    }
    static object View(Song s)
    {
        var layout = ReadLayout(Path.Combine(Folder(s.Id), s.PdfFile));
        return new { s.Id, s.Title, s.PdfStem, pages = layout is null ? s.Pages : 1, pageBreaks = layout?.Breaks,
            s.AudioName, s.Duration, s.Notes, s.LessonUrl, s.Cues, s.Updated, s.BackingName, s.BackingDuration,
            s.BackingImportMessage, s.Rhythm, chordAnalysis = s.ChordAnalysis, audioVersion = s.AudioFile,
            hasAudio = !string.IsNullOrEmpty(s.AudioFile), hasBacking = !string.IsNullOrEmpty(s.BackingFile) };
    }

    static IEnumerable<FileInfo> ScaleBackingTracks()
    {
        var folder = new DirectoryInfo(Path.Combine(Recordings, "Scale-Backing-Tracks"));
        if (!folder.Exists || folder.LinkTarget is not null) return [];
        return folder.EnumerateFiles().Where(file =>
            file.Extension.Equals(".mp3", StringComparison.OrdinalIgnoreCase) &&
            !file.Name.StartsWith('.') && file.LinkTarget is null);
    }

    public static void MapEndpoints(WebApplication app)
    {
        Directory.CreateDirectory(Root);
        app.MapGet("/api/scale-backing", () => Guard(() => Task.FromResult<IResult>(
            Results.Ok(ScaleBackingTracks().OrderBy(file => file.Name, StringComparer.OrdinalIgnoreCase)
                .Select(file => new { file.Name, title = Path.GetFileNameWithoutExtension(file.Name) }).ToArray()))));
        app.MapGet("/api/scale-backing/audio", (string name) => Guard(() =>
        {
            var file = ScaleBackingTracks().FirstOrDefault(candidate => candidate.Name == name);
            if (file is null) throw new FileNotFoundException("Scale backing track not found.");
            return Task.FromResult<IResult>(Results.File(file.FullName, "audio/mpeg", enableRangeProcessing: true));
        }));

        var api = app.MapGroup("/api/song-library");
        api.AddEndpointFilter(async (context, next) =>
        {
            var request = context.HttpContext.Request;
            if (!HttpMethods.IsGet(request.Method))
            {
                string origin = request.Headers.Origin.ToString();
                string ownOrigin = request.Scheme + "://" + request.Host;
                if (request.Headers["Sec-Fetch-Site"] == "cross-site" ||
                    (origin.Length > 0 && !string.Equals(origin, ownOrigin, StringComparison.OrdinalIgnoreCase)))
                    return Results.Json(new { message = "Open the library from this app before changing songs." }, statusCode: 403);
            }
            return await next(context);
        });
        api.MapGet("", () => Guard(async () =>
        {
            var songs = new List<Song>();
            foreach (var file in Directory.EnumerateFiles(Root, "song.json", SearchOption.AllDirectories))
            {
                var song = JsonSerializer.Deserialize<Song>(await File.ReadAllTextAsync(file), Json);
                if (song is not null) songs.Add(song);
            }
            return Results.Ok(songs.OrderBy(s => s.Title, StringComparer.OrdinalIgnoreCase).Select(View));
        }));
        api.MapPost("/pdf", (HttpRequest request) => Guard(async () =>
        {
            var id = Guid.NewGuid();
            Directory.CreateDirectory(Folder(id));
            try
            {
                var pdf = Path.Combine(Folder(id), "original.pdf");
                await Receive(request, pdf, 20 * 1024 * 1024);
                var signature = new byte[5];
                await using (var stream = File.OpenRead(pdf)) await stream.ReadExactlyAsync(signature);
                if (System.Text.Encoding.ASCII.GetString(signature) != "%PDF-")
                    throw new ArgumentException("Choose a PDF file.");
                string hash;
                await using (var stream = File.OpenRead(pdf)) hash = Convert.ToHexString(await SHA256.HashDataAsync(stream));
                foreach (var meta in Directory.EnumerateFiles(Root, "song.json", SearchOption.AllDirectories))
                {
                    var existing = JsonSerializer.Deserialize<Song>(await File.ReadAllTextAsync(meta), Json);
                    if (existing?.PdfHash == hash)
                    {
                        Directory.Delete(Folder(id), true);
                        return Results.Ok(View(existing));
                    }
                }
                var pages = await ReadPdfPageCount(pdf);
                await PrepareContinuousPdf(pdf, pages);
                var name = request.Query["name"].ToString();
                var title = Path.GetFileNameWithoutExtension(name);
                var song = new Song { Id = id, Title = Clean(title, 160, "Untitled song"), Pages = pages, PdfHash = hash, PdfStem = Clean(title, 255, "") };
                await Save(song);
                return Results.Ok(View(song));
            }
            catch
            {
                if (Directory.Exists(Folder(id))) Directory.Delete(Folder(id), true);
                throw;
            }
        }));
        api.MapDelete("/{id:guid}", (Guid id) => Guard(() =>
        {
            _ = Read(id);
            // Move outside the active library: deletion is recoverable and atomic.
            var trash = Path.GetFullPath(Root).TrimEnd(Path.DirectorySeparatorChar) + "-trash";
            Directory.CreateDirectory(trash);
            Directory.Move(Folder(id), Path.Combine(trash, id.ToString("N") + "-" + Guid.NewGuid().ToString("N")));
            return Task.FromResult<IResult>(Results.Ok(new { deleted = true }));
        }));
        api.MapPost("/{id:guid}/pdf", (Guid id, HttpRequest request) => Guard(async () =>
        {
            var song = Read(id);
            var name = "pdf-" + Guid.NewGuid().ToString("N") + ".pdf";
            var path = Path.Combine(Folder(id), name);
            bool committed = false;
            try
            {
                await Receive(request, path, 20 * 1024 * 1024);
                var signature = new byte[5];
                await using (var stream = File.OpenRead(path)) await stream.ReadExactlyAsync(signature);
                if (System.Text.Encoding.ASCII.GetString(signature) != "%PDF-")
                    throw new ArgumentException("Choose a PDF file.");
                var pages = await ReadPdfPageCount(path);
                string hash;
                await using (var stream = File.OpenRead(path)) hash = Convert.ToHexString(await SHA256.HashDataAsync(stream));
                if (song.PdfHash == hash) return Results.Ok(View(song));
                await PrepareContinuousPdf(path, pages);
                // Save the new pointer last. Failed validation never changes the old PDF.
                // Prior PDF files remain available for recovery.
                song.PdfFile = name; song.PdfHash = hash; song.Pages = pages;
                var uploadedName = request.Query["name"].ToString();
                if (!string.IsNullOrWhiteSpace(uploadedName))
                    song.PdfStem = Clean(Path.GetFileNameWithoutExtension(uploadedName), 255, "");
                song.Cues.Clear(); song.ChordAnalysis = null;
                await Save(song);
                committed = true;
                return Results.Ok(View(song));
            }
            finally { if (!committed && File.Exists(path)) File.Delete(path); }
        }));
        api.MapPost("/{id:guid}/audio", (Guid id, HttpRequest request) => Guard(async () =>
        {
            var song = Read(id);
            bool backing = request.Query["variant"] == "backing";
            if (request.Query["variant"].Count > 0 && !backing && request.Query["variant"] != "original")
                throw new ArgumentException("Choose original or backing audio.");
            if (backing && string.IsNullOrEmpty(song.AudioFile))
                throw new ArgumentException("Attach the original MP3 before adding its backing track.");
            var name = "audio-" + Guid.NewGuid().ToString("N") + ".mp3";
            var path = Path.Combine(Folder(id), name);
            bool committed = false;
            try
            {
                await Receive(request, path, 100 * 1024 * 1024);
                string info = await Run("ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=comment:stream=codec_name,codec_type", "-of", "json", path);
                using var parsed = JsonDocument.Parse(info);
                bool mp3 = parsed.RootElement.GetProperty("streams").EnumerateArray().Any(s =>
                    s.TryGetProperty("codec_name", out var codec) && codec.GetString() == "mp3" &&
                    s.TryGetProperty("codec_type", out var kind) && kind.GetString() == "audio");
                if (!mp3 || !double.TryParse(parsed.RootElement.GetProperty("format").GetProperty("duration").GetString(),
                    NumberStyles.Float, CultureInfo.InvariantCulture, out double duration) || !double.IsFinite(duration) || duration <= 0 || duration > 7200)
                    throw new ArgumentException("Choose a valid MP3, no longer than two hours.");
                string hash;
                await using (var stream = File.OpenRead(path)) hash = Convert.ToHexString(await SHA256.HashDataAsync(stream));
                if (string.IsNullOrEmpty(song.AudioHash) && !string.IsNullOrEmpty(song.AudioFile))
                {
                    await using var stream = File.OpenRead(Path.Combine(Folder(id), song.AudioFile));
                    song.AudioHash = Convert.ToHexString(await SHA256.HashDataAsync(stream));
                }
                var uploadName = Clean(Path.GetFileName(request.Query["name"].ToString()), 200, "Recording.mp3");
                if (backing)
                {
                    string comment = "";
                    if (parsed.RootElement.GetProperty("format").TryGetProperty("tags", out var tags) &&
                        tags.TryGetProperty("comment", out var tag)) comment = tag.GetString() ?? "";
                    var source = Regex.Match(comment, @"GPL_SOURCE_SHA256=([A-Fa-f0-9]{64})");
                    if (!source.Success || !string.Equals(source.Groups[1].Value, song.AudioHash, StringComparison.OrdinalIgnoreCase))
                        throw new ArgumentException("This backing track does not match the attached original. Use the Mac backing-track helper with that exact original MP3.");
                    if (Math.Abs(duration - song.Duration) > 0.25)
                        throw new ArgumentException("Backing and original lengths differ. Generate the backing from the exact original without trimming.");
                    song.BackingFile = name; song.BackingName = uploadName; song.BackingDuration = duration;
                }
                else if (string.Equals(song.AudioHash, hash, StringComparison.OrdinalIgnoreCase))
                {
                    // Reattaching the exact same original preserves cues and its backing track.
                    await AttachMatchingBacking(song, uploadName);
                    await Save(song);
                    return Results.Ok(View(song));
                }
                else
                {
                    // Keep prior files on disk. A different recording needs different timing cues.
                    song.AudioFile = name; song.AudioName = uploadName; song.AudioHash = hash;
                    song.Duration = duration; song.Cues.Clear(); song.ChordAnalysis = null; song.Rhythm = null;
                    song.BackingFile = song.BackingName = ""; song.BackingDuration = 0;
                    await AttachMatchingBacking(song, uploadName);
                }
                await Save(song);
                committed = true;
                return Results.Ok(View(song));
            }
            finally { if (!committed && File.Exists(path)) File.Delete(path); }
        }));
        api.MapPost("/{id:guid}/rhythm/analyze", (Guid id, HttpContext context) => Guard(async () =>
        {
            var song = Read(id);
            if (string.IsNullOrEmpty(song.AudioFile))
                throw new ArgumentException("Attach an original MP3 first.");
            var estimate = await SongRhythm.Analyze(Path.Combine(Folder(id), song.AudioFile), context.RequestAborted);
            return Results.Ok(new { estimate, audioVersion = song.AudioFile });
        }));
        api.MapPut("/{id:guid}/rhythm", (Guid id, RhythmEdit edit) => Guard(async () =>
        {
            var song = Read(id);
            if (string.IsNullOrEmpty(song.AudioFile) || edit.AudioVersion != song.AudioFile)
                return Results.Conflict(new { message = "The original MP3 changed. Reopen Rhythm and try again." });
            var rhythm = edit.Rhythm;
            if (rhythm is null || !double.IsFinite(rhythm.Bpm) || rhythm.Bpm < 30 || rhythm.Bpm > 300 ||
                SongRhythm.BeatsPerBar(rhythm.Meter) == 0 ||
                (rhythm.FirstDownbeat is double start && (!double.IsFinite(start) || start < 0 || start >= song.Duration)))
                throw new ArgumentException("Choose a meter and enter a BPM between 30 and 300. The downbeat must be inside the song.");
            song.Rhythm = rhythm with { Confirmed = true };
            await Save(song);
            return Results.Ok(View(song));
        }));
        api.MapPut("/{id:guid}", (Guid id, SongSettings settings) => Guard(async () =>
        {
            var song = Read(id);
            if (settings.Title is not null) song.Title = Clean(settings.Title, 160, "Untitled song");
            if (settings.Notes is not null)
            {
                if (settings.Notes.Length > 10000) throw new ArgumentException("Notes are limited to 10,000 characters.");
                song.Notes = settings.Notes;
            }
            if (settings.LessonUrl is not null) song.LessonUrl = Lessons.ValidateUrl(settings.LessonUrl, allowEmpty: true);
            if (settings.Cues is not null)
            {
                if (settings.Cues.Count > 300) throw new ArgumentException("A song can have up to 300 cues.");
                foreach (var cue in settings.Cues)
                {
                    if (!double.IsFinite(cue.Time) || cue.Time < 0 || cue.Time > song.Duration ||
                        cue.Page < 1 || cue.Page > song.Pages || !double.IsFinite(cue.Position) || cue.Position < 0 || cue.Position > 1 ||
                        !double.IsFinite(cue.Zoom) || cue.Zoom < 1 || cue.Zoom > 3 ||
                        (cue.PageAnchor.HasValue && (!double.IsFinite(cue.PageAnchor.Value) || cue.PageAnchor < 0 || cue.PageAnchor > 1)))
                        throw new ArgumentException("Invalid cue time or PDF position.");
                    cue.Label = Clean(cue.Label, 80, "Section");
                }
                song.Cues = settings.Cues.OrderBy(c => c.Time).ToList();
            }
            await Save(song);
            return Results.Ok(View(song));
        }));
        api.MapGet("/{id:guid}/pdf", (Guid id) => Guard(() =>
        {
            var song = Read(id);
            return Task.FromResult<IResult>(Results.File(Path.Combine(Folder(id), song.PdfFile), "application/pdf", enableRangeProcessing: true));
        }));
        api.MapGet("/{id:guid}/audio", (Guid id, HttpRequest request) => Guard(() =>
        {
            var song = Read(id);
            string variant = request.Query["variant"].ToString();
            if (variant != "" && variant != "original" && variant != "backing")
                throw new ArgumentException("Choose original or backing audio.");
            var file = variant == "backing" ? song.BackingFile : song.AudioFile;
            if (string.IsNullOrEmpty(file)) throw new FileNotFoundException("This audio version has not been attached yet.");
            return Task.FromResult<IResult>(Results.File(Path.Combine(Folder(id), file), "audio/mpeg", enableRangeProcessing: true));
        }));
        api.MapGet("/{id:guid}/simple", (Guid id) => Guard(async () =>
        {
            var file = FindSimplePdf(Read(id));
            var pages = await ReadPdfPageCount(file.FullName);
            await PrepareContinuousPdf(file.FullName, pages);
            var layout = ReadLayout(file.FullName);
            return Results.Ok(new { pages = layout is null ? pages : 1, pageBreaks = layout?.Breaks, updated = PdfRevision(file) });
        }));
        api.MapPost("/{id:guid}/analyze-chords", (Guid id, AnalyzeChordsRequest request, HttpContext context) =>
            AnalyzeSongChords(id, request.Shift, context.RequestAborted));
        api.MapGet("/{id:guid}/chords", (Guid id, HttpRequest request) => Guard(async () =>
        {
            var song = Read(id);
            var (path, revision, _) = ResolvePdf(song, request.Query["variant"].ToString());
            var cache = Path.Combine(Folder(id), "chords-v1-" + revision + ".json");
            if (!File.Exists(cache))
            {
                string xml = await Run("pdftotext", "-bbox-layout", path, "-");
                var pages = PdfChords.Parse(xml);
                var temporary = cache + ".tmp";
                await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(pages, Json));
                File.Move(temporary, cache, true);
            }
            return Results.File(cache, "application/json");
        }));
        api.MapGet("/{id:guid}/page/{page:int}", (Guid id, int page, HttpRequest request) => Guard(async () =>
        {
            var song = Read(id);
            string variant = request.Query["variant"].ToString();
            var (path, revision, layout) = ResolvePdf(song, variant);
            if (page < 1 || page > (layout is not null ? 1 : variant == "simple" ? 100 : song.Pages))
                throw new ArgumentException("Page outside this PDF.");
            var prefix = Path.Combine(Folder(id), "page-" + revision + "-" + page);
            if (!File.Exists(prefix + ".png"))
            {
                var size = layout is null ? new[] { "-scale-to", "1600" } : new[]
                {
                    "-scale-to-x", Math.Clamp((int)Math.Min(Math.Sqrt(12_000_000 / layout.Aspect), 28_000 / layout.Aspect), 1, 1450).ToString(),
                    "-scale-to-y", "-1"
                };
                await Run("pdftoppm", ["-f", page.ToString(), "-l", page.ToString(), "-singlefile", ..size, "-png", path, prefix]);
            }
            return Results.File(prefix + ".png", "image/png");
        }));
    }

    public sealed record AnalyzeChordsRequest(int Shift);

    static async Task<IResult> AnalyzeSongChords(Guid id, int shift, CancellationToken cancellation)
    {
        if (shift is < -12 or > 12)
            return Results.BadRequest(new { message = "Choose a pitch shift between −12 and +12 semitones." });
        if (!ChordAnalysisGate.Wait(0))
            return Results.Conflict(new { message = "A song is already being analyzed. Try again when it finishes." });
        try
        {
            var song = Read(id);
            if (string.IsNullOrEmpty(song.AudioFile))
                throw new ArgumentException("Attach an original MP3 first.");
            if (song.Duration > 900)
                throw new ArgumentException("Chord analysis supports recordings up to 15 minutes.");
            var (pdf, _, _) = ResolvePdf(song, "");
            var pages = PdfChords.Parse(await Run("pdftotext", "-bbox-layout", pdf, "-"));
            var analysis = await SongChordAnalysis.Analyze(Path.Combine(Folder(id), song.AudioFile),
                pages.SelectMany(page => page.Chords).Select(hit => hit.Name), shift, cancellation);
            return await Guard(async () =>
            {
                var latest = Read(id);
                if (latest.AudioFile != song.AudioFile || latest.PdfFile != song.PdfFile)
                    return Results.Conflict(new { message = "The MP3 or PDF changed during analysis. Try again." });
                latest.ChordAnalysis = analysis;
                await Save(latest);
                return Results.Ok(analysis);
            });
        }
        catch (ArgumentException error) { return Results.BadRequest(new { message = error.Message }); }
        catch (FileNotFoundException error) { return Results.NotFound(new { message = error.Message }); }
        catch (Exception error) when (error is IOException or System.ComponentModel.Win32Exception or System.Xml.XmlException)
        {
            Console.Error.WriteLine(error);
            return Results.Problem("Chord analysis could not read the PDF or MP3. Check that Poppler and FFmpeg are installed.");
        }
        finally { ChordAnalysisGate.Release(); }
    }

    static FileInfo FindSimplePdf(Song song)
    {
        var stem = string.IsNullOrWhiteSpace(song.PdfStem) ? song.Title : song.PdfStem;
        if (stem.EndsWith("-simple", StringComparison.OrdinalIgnoreCase) || !Directory.Exists(Recordings))
            throw new FileNotFoundException("No matching simple PDF.");
        var pdfs = Directory.EnumerateFiles(Recordings)
            .Where(path => Path.GetExtension(path).Equals(".pdf", StringComparison.OrdinalIgnoreCase))
            .ToLookup(path => Path.GetFileNameWithoutExtension(path).Normalize(), StringComparer.OrdinalIgnoreCase);
        var matches = pdfs[stem.Normalize() + "-simple"].Take(2).ToArray();
        if (matches.Length == 0)
        {
            // Older library entries retained the editable title but not the upload filename.
            // Recover the filename from an identical standard PDF beside its simple version.
            var imported = new FileInfo(Path.Combine(Folder(song.Id), song.PdfFile));
            var hash = song.PdfHash;
            if (string.IsNullOrEmpty(hash))
            {
                using var original = imported.OpenRead();
                hash = Convert.ToHexString(SHA256.HashData(original));
            }
            var recovered = new List<string>();
            foreach (var group in pdfs)
            {
                if (group.Key.EndsWith("-simple", StringComparison.OrdinalIgnoreCase)) continue;
                var alternatives = pdfs[group.Key + "-simple"].Take(2).ToArray();
                if (alternatives.Length != 1) continue;
                foreach (var candidatePath in group)
                {
                    var candidate = new FileInfo(candidatePath);
                    if (candidate.LinkTarget is not null || candidate.Length != imported.Length) continue;
                    using var stream = candidate.OpenRead();
                    if (!Convert.ToHexString(SHA256.HashData(stream)).Equals(hash, StringComparison.OrdinalIgnoreCase)) continue;
                    recovered.Add(alternatives[0]);
                    break;
                }
            }
            matches = recovered.Take(2).ToArray();
        }
        if (matches.Length != 1) throw new FileNotFoundException("No unique matching simple PDF.");
        var file = new FileInfo(matches[0]);
        if (file.LinkTarget is not null || file.Length > 20 * 1024 * 1024)
            throw new ArgumentException("Use a simple PDF file under 20 MB in recordings.");
        return file;
    }

    static string PdfRevision(FileInfo file) => $"simple-{file.LastWriteTimeUtc.Ticks}-{file.Length}";

    sealed record PdfLayout(double[] Breaks, double Aspect);
    static string ContinuousPath(string source) => Path.Combine(Path.GetDirectoryName(source)!, ".continuous", Path.GetFileName(source));

    static PdfLayout? ReadLayout(string source)
    {
        string converted = ContinuousPath(source);
        string layout = Path.ChangeExtension(converted, ".layout.json");
        if (!File.Exists(source) || !File.Exists(converted) || !File.Exists(layout) || File.GetLastWriteTimeUtc(layout) < File.GetLastWriteTimeUtc(source))
            return null;
        return JsonSerializer.Deserialize<PdfLayout>(File.ReadAllText(layout), Json);
    }

    static async Task PrepareContinuousPdf(string source, int pages)
    {
        if (pages == 1 || ReadLayout(source) is not null) return;
        var script = Path.Combine(AppContext.BaseDirectory, "continuous-pdf.py");
        if (!File.Exists(script)) script = Path.Combine(Directory.GetCurrentDirectory(), "continuous-pdf.py");
        await Run("python3", script, "--file", source);
    }

    static (string Path, string Revision, PdfLayout? Layout) ResolvePdf(Song song, string variant)
    {
        string source, revision;
        if (variant == "")
        {
            source = Path.Combine(Folder(song.Id), song.PdfFile);
            revision = Path.GetFileNameWithoutExtension(song.PdfFile);
        }
        else if (variant == "simple")
        {
            var file = FindSimplePdf(song);
            source = file.FullName;
            revision = PdfRevision(file);
        }
        else throw new ArgumentException("Choose the standard or simple PDF.");

        var layout = ReadLayout(source);
        return layout is null ? (source, revision, null) : (ContinuousPath(source), revision + "-continuous-v1", layout);
    }

    static async Task<int> ReadPdfPageCount(string path)
    {
        var info = await Run("pdfinfo", path);
        var match = Regex.Match(info, @"(?m)^Pages:\s+(\d+)");
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out int pages) || pages < 1 || pages > 100)
            throw new ArgumentException("Use a readable PDF with 1–100 pages.");
        return pages;
    }

    static async Task AttachMatchingBacking(Song song, string originalName)
    {
        if (!string.IsNullOrEmpty(song.BackingFile)) return;
        var match = Regex.Match(originalName, @"^(.*)-original(\.mp3)$", RegexOptions.IgnoreCase);
        if (!match.Success) return;
        string expected = match.Groups[1].Value + "-backing" + match.Groups[2].Value;
        song.BackingImportMessage = "No matching backing found on the Pi. To import from your Mac, select both original and backing MP3 files together.";
        if (!Directory.Exists(Recordings)) return;
        var matches = Directory.EnumerateFiles(Recordings).Where(p =>
            string.Equals(Path.GetFileName(p), expected, StringComparison.OrdinalIgnoreCase)).Take(2).ToArray();
        if (matches.Length == 0) return;
        if (matches.Length > 1)
        {
            song.BackingImportMessage = "More than one matching backing found. Attach the intended backing using Tools.";
            return;
        }
        var name = "audio-" + Guid.NewGuid().ToString("N") + ".mp3";
        var path = Path.Combine(Folder(song.Id), name);
        bool accepted = false;
        try
        {
            var sourceFile = new FileInfo(matches[0]);
            if (sourceFile.Length > 100 * 1024 * 1024 || sourceFile.LinkTarget is not null)
                throw new ArgumentException("Matching backing cannot be imported. Attach it using Tools.");
            File.Copy(matches[0], path);
            var info = await Run("ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags=comment:stream=codec_name,codec_type", "-of", "json", path);
            using var parsed = JsonDocument.Parse(info);
            var format = parsed.RootElement.GetProperty("format");
            bool mp3 = parsed.RootElement.GetProperty("streams").EnumerateArray().Any(s =>
                s.TryGetProperty("codec_name", out var codec) && codec.GetString() == "mp3" &&
                s.TryGetProperty("codec_type", out var type) && type.GetString() == "audio");
            string comment = format.TryGetProperty("tags", out var tags) && tags.TryGetProperty("comment", out var tag)
                ? tag.GetString() ?? "" : "";
            var source = Regex.Match(comment, @"GPL_SOURCE_SHA256=([A-Fa-f0-9]{64})");
            if (!mp3 || !source.Success || !string.Equals(source.Groups[1].Value, song.AudioHash, StringComparison.OrdinalIgnoreCase) ||
                !double.TryParse(format.GetProperty("duration").GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var duration) ||
                !double.IsFinite(duration) || Math.Abs(duration - song.Duration) > 0.25)
                throw new ArgumentException("Matching filename found, but its backing does not match this original. Original saved; attach the correct backing using Tools.");
            song.BackingFile = name; song.BackingName = Clean(Path.GetFileName(matches[0]), 200, "Backing.mp3");
            song.BackingDuration = duration;
            song.BackingImportMessage = "Matching backing attached automatically.";
            accepted = true;
        }
        catch (Exception error) when (error is ArgumentException || error is IOException || error is JsonException ||
            error is KeyNotFoundException || error is System.ComponentModel.Win32Exception || error is UnauthorizedAccessException)
        {
            song.BackingImportMessage = "Original saved. Matching backing could not be verified; attach it using Tools.";
            Console.Error.WriteLine("Automatic backing import: " + error.Message);
        }
        finally { if (!accepted && File.Exists(path)) File.Delete(path); }
    }

    static string Clean(string? value, int max, string fallback)
    {
        var text = new string((value ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (text.Length == 0) return fallback;
        return text[..Math.Min(text.Length, max)];
    }
    static async Task Receive(HttpRequest request, string path, int limit)
    {
        var feature = request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false }) feature.MaxRequestBodySize = limit;
        if (request.ContentLength > limit) throw new ArgumentException($"File exceeds {limit / 1024 / 1024} MB.");
        await using var file = File.Create(path);
        byte[] buffer = new byte[65536];
        long total = 0;
        int read;
        while ((read = await request.Body.ReadAsync(buffer, request.HttpContext.RequestAborted)) > 0)
        {
            total += read;
            if (total > limit) throw new ArgumentException($"File exceeds {limit / 1024 / 1024} MB.");
            await file.WriteAsync(buffer.AsMemory(0, read), request.HttpContext.RequestAborted);
        }
        if (total < 5) throw new ArgumentException("The file is empty or incomplete.");
    }
    static async Task<string> Run(string executable, params string[] args)
    {
        var config = new ProcessStartInfo(executable) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        config.Environment["LC_ALL"] = "C";
        foreach (var arg in args) config.ArgumentList.Add(arg);
        using var process = Process.Start(config) ?? throw new InvalidOperationException("Could not start " + executable);
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { process.Kill(true); throw new ArgumentException("File processing timed out. Try a smaller file."); }
        string result = await output;
        if (process.ExitCode != 0) { _ = await error; throw new ArgumentException("Could not read this file. Check its format and whether the PDF is password protected."); }
        return result;
    }
    static async Task<IResult> Guard(Func<Task<IResult>> action)
    {
        await Gate.WaitAsync();
        try { return await action(); }
        catch (FileNotFoundException e) { return Results.NotFound(new { message = e.Message }); }
        catch (ArgumentException e) { return Results.BadRequest(new { message = e.Message }); }
        catch (BadHttpRequestException) { return Results.BadRequest(new { message = "File upload is too large or incomplete." }); }
        catch (Exception e) when (e is IOException || e is JsonException || e is System.ComponentModel.Win32Exception || e is KeyNotFoundException)
        { Console.Error.WriteLine(e); return Results.Problem("Library operation failed. Check disk space and install poppler-utils and ffmpeg."); }
        finally { Gate.Release(); }
    }
    public sealed record RhythmEdit(string AudioVersion, SongRhythm Rhythm);
    public sealed class Song
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = "";
        public int Pages { get; set; }
        public string PdfStem { get; set; } = "";
        public string PdfHash { get; set; } = "";
        public string PdfFile { get; set; } = "original.pdf";
        public string AudioFile { get; set; } = "";
        public string AudioName { get; set; } = "";
        public string AudioHash { get; set; } = "";
        public string BackingFile { get; set; } = "";
        public string BackingName { get; set; } = "";
        public double BackingDuration { get; set; }
        [System.Text.Json.Serialization.JsonIgnore]
        public string BackingImportMessage { get; set; } = "";
        public double Duration { get; set; }
        public SongRhythm? Rhythm { get; set; }
        public SongChordAnalysis? ChordAnalysis { get; set; }
        public string Notes { get; set; } = "";
        public string LessonUrl { get; set; } = "";
        public List<Cue> Cues { get; set; } = new();
        public DateTimeOffset Updated { get; set; }
    }
    public sealed class SongSettings
    {
        public string? Title { get; set; }
        public string? Notes { get; set; }
        public string? LessonUrl { get; set; }
        public List<Cue>? Cues { get; set; }
    }
    public sealed class Cue
    {
        public double Time { get; set; }
        public int Page { get; set; }
        public double Position { get; set; }
        public double Zoom { get; set; } = 1;
        public double? PageAnchor { get; set; }
        public string Label { get; set; } = "";
    }
}
