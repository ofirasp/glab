using System.Buffers.Binary;
using System.Diagnostics;

public sealed record SongRhythm(double Bpm, string? Meter, double? FirstDownbeat, bool Confirmed = false)
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
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        var errors = process.StandardError.ReadToEndAsync();
        var frames = new List<(double Pulse, double Bass)>();
        var buffer = new byte[hop * 2];
        double low = 0, priorLow = 0, priorHigh = 0;
        try
        {
            while (await process.StandardOutput.BaseStream.ReadAtLeastAsync(buffer, buffer.Length, false, timeout.Token) == buffer.Length)
            {
                double bass = 0, treble = 0;
                for (int i = 0; i < buffer.Length; i += 2)
                {
                    double sample = BinaryPrimitives.ReadInt16LittleEndian(buffer.AsSpan(i, 2)) / 32768.0;
                    low += .09 * (sample - low);
                    bass += low * low;
                    treble += (sample - low) * (sample - low);
                }
                double lowEnergy = Math.Log(1 + 25 * Math.Sqrt(bass / hop));
                double highEnergy = Math.Log(1 + 25 * Math.Sqrt(treble / hop));
                double bassOnset = Math.Max(0, lowEnergy - priorLow);
                frames.Add((bassOnset + Math.Max(0, highEnergy - priorHigh), bassOnset));
                priorLow = lowEnergy;
                priorHigh = highEnergy;
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
        if (candidates.Length == 0 || correlation[candidates[0]] < .12)
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

        // A recurring accent can identify both the bar length and its starting beat.
        var meters = new[] { 3, 4 }.Select(beats =>
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
            return new(bpm, best.Beats + "/4", Math.Round((phase + best.Downbeat * period) / framesPerSecond, 3));

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
        return new(bpm, meter, null);
    }

    static IEnumerable<double> BeatStrength(int phase, double period, List<(double Pulse, double Bass)> frames, bool bassOnly)
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
