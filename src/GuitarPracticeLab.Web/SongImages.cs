using System.Text;

public static partial class SongLibrary
{
    public sealed record SongImage(Guid Id, string Name, string File, string ContentType);
    static void MapSongImages(RouteGroupBuilder api)
    {
        api.MapPost("/{id:guid}/images", (Guid id, HttpRequest request) => Guard(async () =>
        {
            var song = Read(id);
            if (song.Images.Count >= 30) throw new ArgumentException("A song can have up to 30 images.");
            var imageId = Guid.NewGuid();
            var file = Path.Combine(Folder(id), "image-" + imageId.ToString("N"));
            try
            {
                await Receive(request, file, 8 * 1024 * 1024);
                byte[] header = new byte[12];
                using (var input = File.OpenRead(file))
                {
                    if (input.Length < header.Length) throw new ArgumentException("The image is incomplete.");
                    await input.ReadExactlyAsync(header);
                }
                string mime = header.AsSpan(0, 8).SequenceEqual(new byte[] { 137,80,78,71,13,10,26,10 }) ? "image/png"
                    : header[0] == 255 && header[1] == 216 && header[2] == 255 ? "image/jpeg"
                    : Encoding.ASCII.GetString(header,0,4) == "RIFF" && Encoding.ASCII.GetString(header,8,4) == "WEBP" ? "image/webp"
                    : throw new ArgumentException("Choose a PNG, JPEG or WebP image.");
                song.Images.Add(new SongImage(imageId, Clean(Path.GetFileName(request.Query["name"].ToString()),160,"Image"), Path.GetFileName(file), mime));
                await Save(song);
                return Results.Ok(View(song));
            }
            catch { File.Delete(file); throw; }
        }));
        api.MapGet("/{id:guid}/images/{imageId:guid}", (Guid id, Guid imageId) => Guard(() =>
        {
            var image = Read(id).Images.FirstOrDefault(i => i.Id == imageId) ?? throw new FileNotFoundException("Image not found.");
            return Task.FromResult<IResult>(Results.File(Path.Combine(Folder(id),Path.GetFileName(image.File)),image.ContentType));
        }));
        api.MapDelete("/{id:guid}/images/{imageId:guid}", (Guid id, Guid imageId) => Guard(async () =>
        {
            var song=Read(id);var image=song.Images.FirstOrDefault(i=>i.Id==imageId) ?? throw new FileNotFoundException("Image not found.");
            song.Images.Remove(image);await Save(song);File.Delete(Path.Combine(Folder(id),Path.GetFileName(image.File)));
            return Results.Ok(View(song));
        }));
    }
}
