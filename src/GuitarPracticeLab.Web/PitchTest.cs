
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

        double left = normalized[lag - 1];
        double center = normalized[lag];
        double right = normalized[lag + 1];
        double divisor = left - 2 * center + right;
        double correction = Math.Abs(divisor) > 1e-12
            ? 0.5 * (left - right) / divisor : 0;

        return sampleRate / (lag + correction);
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
