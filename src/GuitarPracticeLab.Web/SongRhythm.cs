using System.Buffers.Binary;
using System.Diagnostics;
using System.Numerics;

public sealed record SongRhythm(double Bpm, string? Meter, double? FirstDownbeat, bool Confirmed = false, List<SongRhythmPoint>? Points = null)
{
    public static int BeatsPerBar(string? meter) => meter switch
    {
        "2/4" or "6/8" => 2,
        "3/4" or "9/8" => 3,
        "4/4" or "12/8" => 4,
        "5/4" => 5,
        "7/4" => 7,
        _ => 0
    };

    public static async Task<SongRhythm> Analyze(string path, CancellationToken cancellation)
    {
        const int rate = 8000, hop = 80, framesPerSecond = rate / hop;
        var info = new ProcessStartInfo("ffmpeg")
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var arg in new[] { "-nostdin", "-v", "error", "-i", path, "-t", "90",
                     "-vn", "-ac", "1", "-ar", rate.ToString(), "-f", "s16le", "pipe:1" })
            info.ArgumentList.Add(arg);

        using var process = Process.Start(info) ?? throw new IOException("Could not start audio analysis.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        var errors = process.StandardError.ReadToEndAsync();
        var frames = new List<(double Pulse, double Bass)>();
        var buffer = new byte[hop * 2];
        const int size = 512;
        var samples = new double[size];
        var spectrum = new Complex[size];
        var previous = new double[size / 2];
        var hann = Enumerable.Range(0, size).Select(i => .5 - .5 * Math.Cos(2 * Math.PI * i / (size - 1))).ToArray();
        try
        {
            while (await process.StandardOutput.BaseStream.ReadAtLeastAsync(buffer, buffer.Length, false, timeout.Token) == buffer.Length)
            {
                Array.Copy(samples, hop, samples, 0, size - hop);
                for (int i = 0; i < hop; i++)
                    samples[size - hop + i] = BinaryPrimitives.ReadInt16LittleEndian(buffer.AsSpan(i * 2, 2)) / 32768.0;
                for (int i = 0; i < size; i++) spectrum[i] = new(samples[i] * hann[i], 0);
                Transform(spectrum);
                double bass = 0, flux = 0;
                // Spectral changes retain drum attacks even when the mix's overall
                // loudness stays constant or a sustained vocal dominates the energy.
                for (int bin = 3; bin < previous.Length; bin++)
                {
                    double value = Math.Log(1 + 10 * spectrum[bin].Magnitude);
                    double onset = Math.Max(0, value - previous[bin]);
                    flux += onset;
                    if (bin <= 16) bass += onset;
                    previous[bin] = value;
                }
                frames.Add((flux, bass));
            }
            await process.WaitForExitAsync(timeout.Token);
            if (process.ExitCode != 0) throw new ArgumentException("Could not decode the original MP3.");
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            throw new ArgumentException("Rhythm analysis timed out.");
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await errors;
        }

        if (frames.Count < 8 * framesPerSecond || frames.Max(frame => frame.Pulse) < .01)
            throw new ArgumentException("Could not find a steady rhythm. Enter BPM and meter manually.");

        double[] pulse = frames.Select(frame => frame.Pulse).ToArray();
        double average = pulse.Average();
        double energy = pulse.Sum(value => (value - average) * (value - average));
        if (energy <= 0) throw new ArgumentException("Could not find a steady beat. Enter BPM manually.");
        var correlation = new double[222];
        for (int lag = 32; lag < correlation.Length; lag++)
        {
            double sum = 0;
            for (int i = lag; i < pulse.Length; i++)
                sum += (pulse[i] - average) * (pulse[i - lag] - average);
            correlation[lag] = sum / energy;
        }

        var candidates = Enumerable.Range(33, 78)
            .Where(lag => correlation[lag] >= correlation[lag - 1] && correlation[lag] >= correlation[lag + 1])
            .OrderByDescending(lag => correlation[lag] + .45 * correlation[lag * 2] - .07 * Math.Abs(Math.Log(lag / 55.0)))
            .ToArray();
        if (candidates.Length == 0 || correlation[candidates[0]] < .04)
            throw new ArgumentException("Could not find a steady beat. Enter BPM manually.");

        int peak = candidates[0];
        double curvature = correlation[peak - 1] - 2 * correlation[peak] + correlation[peak + 1];
        double period = peak + (curvature < 0 ? .5 * (correlation[peak - 1] - correlation[peak + 1]) / curvature : 0);
        int phase = Enumerable.Range(0, peak)
            .MaxBy(offset => BeatStrength(offset, period, frames, bassOnly: false).Average());
        var accents = BeatStrength(phase, period, frames, bassOnly: true).ToArray();
        double mean = accents.Average();
        double deviation = Math.Sqrt(accents.Average(value => (value - mean) * (value - mean)));
        double bpm = Math.Round(6000 / period, 1);
        if (deviation < .001) return new(bpm, null, null);

        double subdivisionStrength(double fraction) =>
            BeatStrength(phase + period * fraction, period, frames, bassOnly: false).Average();
        double triplet = (subdivisionStrength(1.0 / 3) + subdivisionStrength(2.0 / 3)) / 2;
        double duple = subdivisionStrength(.5);
        double mainStrength = subdivisionStrength(0);
        bool compound = triplet > duple * 1.35 && triplet > mainStrength * .35;

        // A recurring accent can identify both the bar length and its starting beat.
        var meters = (compound ? new[] { 2, 3, 4 } : new[] { 3, 4 }).Select(beats =>
        {
            var phases = Enumerable.Range(0, beats)
                .Select(index => accents.Where((_, beat) => beat % beats == index).Average()).ToArray();
            int downbeat = Array.IndexOf(phases, phases.Max());
            double score = (phases[downbeat] - phases.Where((_, index) => index != downbeat).Max()) / deviation;
            return (Beats: beats, Downbeat: downbeat, Score: score);
        }).OrderByDescending(meter => meter.Score).ToArray();
        var best = meters[0];
        bool clear = best.Score > .45 && best.Score - meters[1].Score > .25;
        if (clear)
            return new(bpm, compound ? (best.Beats * 3) + "/8" : best.Beats + "/4", Math.Round((phase + best.Downbeat * period) / framesPerSecond, 3));

        // A drum or bass pattern can repeat each bar without a single dominant beat.
        // Compare the first two repetitions against other plausible beat groupings.
        double[] bassFlux = frames.Select(frame => frame.Bass).ToArray();
        double bassMean = bassFlux.Average();
        for (int i = 0; i < bassFlux.Length; i++) bassFlux[i] -= bassMean;
        double bassEnergy = bassFlux.Sum(value => value * value);
        if (bassEnergy <= 0) return new(bpm, null, null);

        double Similarity(int beats)
        {
            int expected = (int)Math.Round(beats * period);
            double strongest = 0;
            for (int lag = expected - 3; lag <= expected + 3; lag++)
            {
                double sum = 0;
                for (int i = lag; i < bassFlux.Length; i++) sum += bassFlux[i] * bassFlux[i - lag];
                strongest = Math.Max(strongest, sum / bassEnergy);
            }
            return strongest;
        }

        double two = Similarity(2), three = Similarity(3), four = Similarity(4);
        double six = Similarity(6), eight = Similarity(8);
        const double margin = .045;
        string? meter = null;
        if (four >= .16 && four > Math.Max(two, three) + margin && eight > six + margin)
            meter = "4/4";
        else if (three >= .16 && three > Math.Max(two, four) + margin && six > eight + margin)
            meter = "3/4";

        // Bar repetition alone does not tell us which beat starts the bar.
        if (compound) meter = meter == "3/4" ? "9/8" : meter == "4/4" ? "12/8" : "6/8";
        return new(bpm, meter, null);
    }

    static void Transform(Complex[] values)
    {
        int size = values.Length;
        for (int i = 1, j = 0; i < size; i++)
        {
            int bit = size >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) (values[i], values[j]) = (values[j], values[i]);
        }
        for (int length = 2; length <= size; length <<= 1)
        {
            var step = Complex.FromPolarCoordinates(1, -2 * Math.PI / length);
            for (int i = 0; i < size; i += length)
            {
                var weight = Complex.One;
                for (int j = 0; j < length / 2; j++)
                {
                    var first = values[i + j];
                    var second = values[i + j + length / 2] * weight;
                    values[i + j] = first + second;
                    values[i + j + length / 2] = first - second;
                    weight *= step;
                }
            }
        }
    }

    static IEnumerable<double> BeatStrength(double phase, double period, List<(double Pulse, double Bass)> frames, bool bassOnly)
    {
        for (double beat = phase; beat < frames.Count; beat += period)
        {
            double strength = 0;
            for (int i = Math.Max(0, (int)beat - 3); i <= Math.Min(frames.Count - 1, (int)beat + 3); i++)
                strength += bassOnly ? frames[i].Bass : frames[i].Pulse;
            yield return strength;
        }
    }
}

public sealed record SongRhythmPoint(double Time, double Bpm, string? Meter);
