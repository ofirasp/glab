
public static class PitchTest
{
    const int sampleRate = 16000;
public static double? Detect(double[] audio)
{
    double rms = Math.Sqrt(audio.Select(x => x * x).Average());
    if (rms < 0.002) return null;

    const int maxLag = 400;
    int window = audio.Length - maxLag;
    var difference = new double[maxLag + 1];
    var normalized = new double[maxLag + 1];
    normalized[0] = 1;
    double running = 0;

    for (int lag = 1; lag <= maxLag; lag++)
    {
        double sum = 0;
        for (int i = 0; i < window; i++)
        {
            double delta = audio[i] - audio[i + lag];
            sum += delta * delta;
        }
        difference[lag] = sum;
        running += sum;
        normalized[lag] = running > 0 ? sum * lag / running : 1;
    }

    for (int lag = 16; lag < maxLag - 1; lag++)
    {
        if (normalized[lag] >= 0.15) continue;
        while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag])
            lag++;

        if (lag >= maxLag) return null;

        double RefinedLag(int index)
        {
            double divisor = normalized[index - 1] - 2 * normalized[index] + normalized[index + 1];
            double correction = Math.Abs(divisor) > 1e-12
                ? 0.5 * (normalized[index - 1] - normalized[index + 1]) / divisor : 0;
            return index + Math.Clamp(correction, -.5, .5);
        }
        double Trough(int index)
        {
            double left = normalized[index - 1], center = normalized[index], right = normalized[index + 1];
            double curvature = left - 2 * center + right;
            return Math.Max(0, curvature > 1e-12 ? center - (left - right) * (left - right) / (8 * curvature) : center);
        }

        // A ringing guitar string can lose its fundamental while its third
        // harmonic remains loud. The first acceptable YIN trough then reports
        // that harmonic. Recover the fundamental only if its longer period
        // explains the waveform substantially better. Clean single tones must
        // retain their pitch, rather than being divided into subharmonics.
        int bestLag = lag;
        double initialPeriod = RefinedLag(lag), bestError = Trough(lag);
        if (bestError > .01)
        {
            for (int multiple = 2; multiple <= 4; multiple++)
            {
                int expected = (int)Math.Round(initialPeriod * multiple);
                int from = Math.Max(17, expected - 2), to = Math.Min(maxLag - 2, expected + 2);
                for (int candidate = from; candidate <= to; candidate++)
                {
                    if (normalized[candidate] > normalized[candidate - 1] || normalized[candidate] > normalized[candidate + 1]) continue;
                    double error = Trough(candidate);
                    if (normalized[candidate] < .15 && error < bestError * .35)
                    {
                        bestLag = candidate;
                        bestError = error;
                    }
                }
            }
        }
        return sampleRate / RefinedLag(bestLag);
    }
    return null;
}


    public static object Analyze(int index, int offset)
    {
        string[] names = ["E2", "A2", "D3", "G3", "B3", "E4"];
        double[] frequencies = [82.4069, 110, 146.8324, 195.9977, 246.9417, 329.6276];
        double reference = frequencies[index];
        double target = reference * Math.Pow(2, offset / 1200.0);
        var samples = new double[4096];

        for (int i = 0; i < samples.Length; i++)
        {
            double phase = 2 * Math.PI * target * i / sampleRate;
            double envelope = Math.Exp(-2.0 * i / sampleRate);
            samples[i] = envelope * (
                0.3 * Math.Sin(phase) +
                0.15 * Math.Sin(2 * phase) +
                0.07 * Math.Sin(3 * phase));
        }

        var watch = System.Diagnostics.Stopwatch.StartNew();
        double? measured = Detect(samples);
        watch.Stop();

        double? cents = measured.HasValue
            ? 1200 * Math.Log2(measured.Value / reference) : null;

        return new {
            note = names[index],
            frequency = measured,
            cents,
            analysisMs = watch.Elapsed.TotalMilliseconds,
            input = "Generated test audio"
        };
    }
}
