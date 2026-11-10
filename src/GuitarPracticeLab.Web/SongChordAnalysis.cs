using System.Buffers.Binary;
using System.Diagnostics;

public sealed record SongChordAnalysis(int Shift, List<SongChordAnalysis.SongChordChange> Changes)
{
    public sealed record SongChordChange(double Time, string? Name);

    public static async Task<SongChordAnalysis> Analyze(string audio, IEnumerable<string> names, int shift, CancellationToken cancellation)
    {
        var occurrences = names.GroupBy(name => name, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        var candidates = Candidates(occurrences.Keys, shift);
        if (candidates.Count == 0)
            throw new ArgumentException("No supported chord names were found in the PDF text.");

        var info = new ProcessStartInfo("ffmpeg")
        {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false
        };
        foreach (string argument in new[] { "-nostdin", "-v", "error", "-i", audio, "-vn", "-ac", "1",
                     "-ar", "16000", "-f", "s16le", "pipe:1" })
            info.ArgumentList.Add(argument);

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(TimeSpan.FromMinutes(3));
        using var process = Process.Start(info) ?? throw new IOException("Could not start FFmpeg.");
        var errors = process.StandardError.ReadToEndAsync();
        var bytes = new byte[ChordDetector.Size * 2];
        var samples = new double[ChordDetector.Size];
        var detector = new ChordDetector();
        var frames = new List<(double[] Chroma, double[] Bass)?>();
        try
        {
            var stream = process.StandardOutput.BaseStream;
            while (await stream.ReadAtLeastAsync(bytes, bytes.Length, false, deadline.Token) == bytes.Length)
            {
                for (int i = 0; i < samples.Length; i++)
                    samples[i] = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(i * 2, 2)) / 32768.0;
                var (_, chroma) = detector.Measure(samples, .003);
                double total = chroma?.Sum() ?? 0;
                if (total <= 1e-9) frames.Add(null);
                else
                {
                    // Normalize each frame so loud vocal or drum peaks cannot dominate the average.
                    for (int pitch = 0; pitch < chroma!.Length; pitch++) chroma[pitch] /= total;
                    frames.Add((chroma, detector.BassChroma()));
                }
            }
            await process.WaitForExitAsync(deadline.Token);
            if (process.ExitCode != 0) throw new ArgumentException("Could not decode the original MP3.");
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            throw new ArgumentException("Chord analysis timed out on this recording.");
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await errors;
        }
        int mostCommon = candidates.Max(chord => occurrences[chord.Name]);
        var rarity = candidates.ToDictionary(chord => chord.Name,
            chord => Math.Min(.16, .045 * Math.Log((double)mostCommon / occurrences[chord.Name])));
        return new(shift, BuildTimeline(frames, candidates, rarity));
    }

    public static List<GuitarChord> Candidates(IEnumerable<string> names, int shift)
    {
        var candidates = new List<GuitarChord>();
        foreach (string name in names.Distinct(StringComparer.Ordinal))
        {
            try
            {
                // Slash voicings need reliable bass detection, so leave them out of this first pass.
                var chord = GuitarChord.Parse(name);
                if (chord.Notes.Length < 3) continue;
                int Transpose(int pitch) => (pitch + shift + 12) % 12;
                candidates.Add(new(name, chord.Notes.Select(Transpose).ToArray(), chord.Required.Select(Transpose).ToArray()));
            }
            catch (ArgumentException) { }
        }
        return candidates;
    }

    static List<SongChordChange> BuildTimeline(List<(double[] Chroma, double[] Bass)?> frames, List<GuitarChord> candidates, Dictionary<string, double> rarity)
    {
        const double secondsPerWindow = (double)ChordDetector.Size / ChordDetector.Rate;
        var changes = new List<SongChordChange>();
        var neighborhood = new double[12];
        var bass = new double[12];
        string? last = null, proposed = null;
        const int confirmationWindows = 3;
        int stable = 0;
        for (int frame = 0; frame < frames.Count; frame++)
        {
            Array.Clear(neighborhood);
            Array.Clear(bass);
            // Smooth across roughly a second to reduce the effect of individual melody notes.
            for (int offset = -2; offset <= 2; offset++)
            {
                int index = frame + offset;
                if (index < 0 || index >= frames.Count || frames[index] is not { } reading) continue;
                int weight = 3 - Math.Abs(offset);
                for (int pitch = 0; pitch < neighborhood.Length; pitch++)
                {
                    neighborhood[pitch] += weight * reading.Chroma[pitch];
                    bass[pitch] += weight * reading.Bass[pitch];
                }
            }
            string? match = frames[frame] is null ? null : Match(neighborhood, candidates, bass: bass, rarity: rarity);
            if (match != proposed) { proposed = match; stable = 0; }
            if (++stable < confirmationWindows || proposed is null || last == proposed) continue;
            changes.Add(new(Math.Round((frame - confirmationWindows + 1) * secondsPerWindow, 3), proposed));
            last = proposed;
        }
        return changes;
    }

    public static string? Match(double[] chroma, List<GuitarChord> candidates, bool live = false, double[]? bass = null, Dictionary<string, double>? rarity = null)
    {
        double total = chroma.Sum(), peak = chroma.Max();
        if (total <= 1e-9) return null;
        double bassTotal = bass?.Sum() ?? 0;
        string? best = null;
        double highest = 0, second = 0;
        foreach (var chord in candidates)
        {
            int heard = chord.Required.Count(note => chroma[note] >= peak * .12);
            if (heard < (live ? chord.Required.Length : 2)) continue;
            // Root and defining interval distinguish lookalikes such as Asus2 and Asus4.
            double bassSupport = bassTotal > 0 ? bass![chord.Required[0]] / bassTotal : 0;
            if (!live && chroma[chord.Required[0]] < peak * .12 && bassSupport < .18) continue;
            double coverage = chord.Notes.Sum(note => chroma[note]) / total;
            if (coverage < (live ? .78 : .50)) continue;
            double score = coverage + .12 * heard / chord.Required.Length + .30 * bassSupport - (rarity?.GetValueOrDefault(chord.Name) ?? 0);
            if (!live && chroma[chord.Required[1]] < peak * .12) score -= .12;
            if (score > highest) { second = highest; highest = score; best = chord.Name; }
            else if (score > second) second = score;
        }
        return highest - second >= (live ? .08 : .045) ? best : null;
    }
}
