using System.Buffers.Binary;
using System.Diagnostics;

public sealed record SongChordAnalysis(int Shift, List<SongChordAnalysis.SongChordChange> Changes)
{
    public sealed record SongChordChange(double Time, string? Name);

    public static async Task<SongChordAnalysis> Analyze(string audio, IEnumerable<string> names, int shift, CancellationToken cancellation)
    {
        var candidates = Candidates(names, shift);
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
        return new(shift, BuildTimeline(frames, candidates));
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

    internal static List<SongChordChange> BuildTimeline(List<(double[] Chroma, double[] Bass)?> frames, List<GuitarChord> candidates)
    {
        const double secondsPerWindow = (double)ChordDetector.Size / ChordDetector.Rate;
        var changes = new List<SongChordChange>();
        var neighborhood = new double[12];
        var bass = new double[12];
        if (frames.Count == 0) return changes;
        // Choose a path through the whole track. Brief weak frames can support a
        // change without having to independently win two hard classification gates.
        const double changeCost = .30;
        int count = candidates.Count;
        var previous = new double[count];
        var scores = new double[count];
        var parents = new int[frames.Count, count];
        for (int frame = 0; frame < frames.Count; frame++)
        {
            Array.Clear(neighborhood);
            Array.Clear(bass);
            // Keep smoothing local so longer neighboring chords do not bury brief changes.
            for (int offset = -1; offset <= 1; offset++)
            {
                int index = frame + offset;
                if (index < 0 || index >= frames.Count || frames[index] is not { } reading) continue;
                int weight = 2 - Math.Abs(offset);
                for (int pitch = 0; pitch < neighborhood.Length; pitch++)
                {
                    neighborhood[pitch] += weight * reading.Chroma[pitch];
                    bass[pitch] += weight * reading.Bass[pitch];
                }
            }
            double total = neighborhood.Sum(), bassTotal = bass.Sum();
            int strongest = 0;
            for (int index = 1; index < count; index++)
                if (previous[index] > previous[strongest]) strongest = index;
            for (int index = 0; index < count; index++)
            {
                var chord = candidates[index];
                int root = chord.Required[0];
                double evidence = total > 0
                    ? chord.Notes.Sum(note => neighborhood[note]) / total
                        + .34 * (bassTotal > 0 ? bass[root] / bassTotal : 0)
                        - (neighborhood[chord.Required[1]] < total * .035 ? .12 : 0)
                    : 0;
                bool change = previous[strongest] - changeCost > previous[index];
                int parent = change ? strongest : index;
                scores[index] = previous[parent] + evidence - (change ? changeCost : 0);
                parents[frame, index] = parent;
            }
            (previous, scores) = (scores, previous);
        }

        int last = Array.IndexOf(previous, previous.Max());
        var path = new int[frames.Count];
        for (int frame = frames.Count - 1; frame >= 0; frame--)
        {
            path[frame] = last;
            last = parents[frame, last];
        }
        last = -1;
        for (int frame = 0; frame < frames.Count; frame++)
        {
            if (frames[frame] is null || path[frame] == last) continue;
            last = path[frame];
            changes.Add(new(Math.Round(frame * secondsPerWindow, 3), candidates[last].Name));
        }
        return changes;
    }

    public static string? MatchLive(double[] chroma, List<GuitarChord> candidates)
    {
        double total = chroma.Sum(), peak = chroma.Max();
        if (total <= 1e-9) return null;
        string? best = null;
        double highest = 0, second = 0;
        foreach (var chord in candidates)
        {
            if (chord.Required.Any(note => chroma[note] < peak * .12)) continue;
            double coverage = chord.Notes.Sum(note => chroma[note]) / total;
            if (coverage < .70) continue;
            if (coverage > highest) { second = highest; highest = coverage; best = chord.Name; }
            else if (coverage > second) second = coverage;
        }
        return highest - second >= .045 ? best : null;
    }
}
