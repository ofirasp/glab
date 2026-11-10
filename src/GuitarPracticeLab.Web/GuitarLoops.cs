using System.Buffers.Binary;

public static class GuitarLoops
{
    public const int MaxSeconds = 600;
    const int BytesPerSecond = 32000;
    const int HeaderSize = 44;
    const int MaxBytes = HeaderSize + MaxSeconds * BytesPerSecond;
    static string Root => Environment.GetEnvironmentVariable("GUITAR_LOOPS_ROOT")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "GuitarPracticeLab", "loops");
    static string Folder(Guid id) => Path.Combine(Root, id.ToString("N"));
    sealed record SavedLoop(Guid Id, string Name, double Seconds, DateTimeOffset Created);

    public static void MapEndpoints(WebApplication app)
    {
        var api = app.MapGroup("/api/guitar-loops");
        api.AddEndpointFilter(async (context, next) =>
        {
            var request = context.HttpContext.Request;
            string origin = request.Headers.Origin.ToString();
            if (!HttpMethods.IsGet(request.Method) &&
                (request.Headers["Sec-Fetch-Site"] == "cross-site" ||
                 (origin.Length > 0 && !string.Equals(origin, request.Scheme + "://" + request.Host, StringComparison.OrdinalIgnoreCase))))
                return Results.Json(new { message = "Open Looper from the app." }, statusCode: 403);
            try { return await next(context); }
            catch (IOException) { return Results.Problem("Could not read or save the loop on the Pi."); }
            catch (UnauthorizedAccessException) { return Results.Problem("The app cannot access the loop folder."); }
        });
        api.MapGet("", () =>
        {
            if (!Directory.Exists(Root)) return Results.Ok(Array.Empty<SavedLoop>());
            var loops = Directory.EnumerateDirectories(Root)
                .Where(path => Guid.TryParseExact(Path.GetFileName(path), "N", out _))
                .Select(path =>
                {
                    try { return System.Text.Json.JsonSerializer.Deserialize<SavedLoop>(File.ReadAllText(Path.Combine(path, "loop.json"))); }
                    catch (FileNotFoundException) { return null; }
                    catch (DirectoryNotFoundException) { return null; }
                    catch (System.Text.Json.JsonException) { return null; }
                }).OfType<SavedLoop>().OrderByDescending(loop => loop.Created).ToArray();
            return Results.Ok(loops);
        });
        api.MapGet("/{id:guid}/audio", (Guid id) =>
        {
            var path = Path.Combine(Folder(id), "take.wav");
            return File.Exists(path) ? Results.File(path, "audio/wav", enableRangeProcessing: true) : Results.NotFound();
        });
        api.MapDelete("/{id:guid}", (Guid id) =>
        {
            var path = Folder(id);
            if (!Directory.Exists(path)) return Results.NotFound();
            var discarded = Path.Combine(Root, ".delete-" + Guid.NewGuid().ToString("N"));
            Directory.Move(path, discarded);
            Directory.Delete(discarded, recursive: true);
            return Results.NoContent();
        });
        api.MapPost("", Save);
    }

    static async Task<IResult> Save(HttpRequest request, string? name, CancellationToken cancellation)
    {
        name = name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 80 || name.Any(char.IsControl))
            return Results.BadRequest(new { message = "Enter a name up to 80 characters." });
        if (request.ContentLength > MaxBytes)
            return Results.BadRequest(new { message = "Loops are limited to 10 minutes." });
        var id = Guid.NewGuid();
        var staging = Path.Combine(Root, ".saving-" + id.ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            var header = new byte[HeaderSize];
            try { await request.Body.ReadExactlyAsync(header, cancellation); }
            catch (EndOfStreamException) { return Results.BadRequest(new { message = "The take is incomplete." }); }
            if (!ValidHeader(header))
                return Results.BadRequest(new { message = "Record a take with Looper before saving." });
            int size = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(40));
            if (size < 2 || size > MaxBytes - HeaderSize || size % 2 != 0)
                return Results.BadRequest(new { message = "The recording length is invalid." });
            await using (var output = File.Create(Path.Combine(staging, "take.wav")))
            {
                await output.WriteAsync(header, cancellation);
                var buffer = new byte[8192];
                for (int remaining = size; remaining > 0;)
                {
                    int read = await request.Body.ReadAsync(buffer.AsMemory(0, Math.Min(remaining, buffer.Length)), cancellation);
                    if (read == 0) return Results.BadRequest(new { message = "The take is incomplete." });
                    await output.WriteAsync(buffer.AsMemory(0, read), cancellation);
                    remaining -= read;
                }
                if (await request.Body.ReadAsync(buffer.AsMemory(0, 1), cancellation) != 0)
                    return Results.BadRequest(new { message = "The take contains extra data." });
            }
            var loop = new SavedLoop(id, name, size / (double)BytesPerSecond, DateTimeOffset.UtcNow);
            await File.WriteAllTextAsync(Path.Combine(staging, "loop.json"), System.Text.Json.JsonSerializer.Serialize(loop), cancellation);
            Directory.Move(staging, Folder(id));
            return Results.Ok(loop);
        }
        finally { if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true); }
    }

    static bool ValidHeader(byte[] header) =>
        header.AsSpan(0, 4).SequenceEqual("RIFF"u8) &&
        header.AsSpan(8, 8).SequenceEqual("WAVEfmt "u8) &&
        header.AsSpan(36, 4).SequenceEqual("data"u8) &&
        BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(16)) == 16 &&
        BinaryPrimitives.ReadInt16LittleEndian(header.AsSpan(20)) == 1 &&
        BinaryPrimitives.ReadInt16LittleEndian(header.AsSpan(22)) == 1 &&
        BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(24)) == 16000 &&
        BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(28)) == BytesPerSecond &&
        BinaryPrimitives.ReadInt16LittleEndian(header.AsSpan(32)) == 2 &&
        BinaryPrimitives.ReadInt16LittleEndian(header.AsSpan(34)) == 16 &&
        BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4)) == 36UL + BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(40));
}
