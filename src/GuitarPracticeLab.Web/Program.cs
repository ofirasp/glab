using GuitarPracticeLab.Web.Components;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();


app.MapGet("/api/pitch-test/{index:int}/{offset:int}", (int index, int offset) =>
{
    if (index < 0 || index > 5 || offset < -45 || offset > 45)
        return Results.BadRequest("Invalid string or tuning offset.");
    return Results.Ok(PitchTest.Analyze(index, offset));
});


app.MapPost("/api/analyze-wav", async (HttpRequest request) =>
{
    const int limit = 8 * 1024 * 1024;
    if (request.ContentLength > limit)
        return Results.BadRequest(new { message = "Maximum file size is 8 MB." });

    using var memory = new MemoryStream();
    var buffer = new byte[8192];
    int read;
    while ((read = await request.Body.ReadAsync(buffer.AsMemory(), request.HttpContext.RequestAborted)) > 0)
    {
        if (memory.Length + read > limit)
            return Results.BadRequest(new { message = "Maximum file size is 8 MB." });
        memory.Write(buffer, 0, read);
    }
    try
    {
        return Results.Ok(WavPitch.Analyze(memory.ToArray()));
    }
    catch (Exception error) when (
        error is ArgumentException || error is EndOfStreamException ||
        error is OverflowException)
    {
        return Results.BadRequest(new { message = error.Message });
    }
});


SongLibrary.MapEndpoints(app);

app.Run();
