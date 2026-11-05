public static class WavPitch
{
    public static object Analyze(byte[] file)
    {
        using var stream = new MemoryStream(file);
        using var reader = new BinaryReader(stream);

        string Tag() => System.Text.Encoding.ASCII.GetString(reader.ReadBytes(4));
        if (stream.Length < 12 || Tag() != "RIFF")
            throw new ArgumentException("Expected a WAV file.");
        reader.ReadUInt32();
        if (Tag() != "WAVE")
            throw new ArgumentException("Expected a WAV file.");

        int format = 0, channels = 0, rate = 0, bits = 0, align = 0;
        byte[]? data = null;

        while (stream.Position + 8 <= stream.Length)
        {
            string tag = Tag();
            uint size = reader.ReadUInt32();
            long end = stream.Position + size;
            if (end > stream.Length)
                throw new ArgumentException("Incomplete WAV file.");

            if (tag == "fmt " && size >= 16)
            {
                format = reader.ReadUInt16();
                channels = reader.ReadUInt16();
                rate = reader.ReadInt32();
                reader.ReadUInt32();
                align = reader.ReadUInt16();
                bits = reader.ReadUInt16();
            }
            else if (tag == "data")
            {
                data = reader.ReadBytes(checked((int)size));
            }
            stream.Position = Math.Min(stream.Length, end + (size % 2));
        }

        if (format != 1 || bits != 16 || channels < 1 || channels > 2)
            throw new ArgumentException("Use 16-bit PCM WAV, mono or stereo.");
        if (rate < 8000 || rate > 96000 || align != channels * 2 ||
            data is null || data.Length % align != 0)
            throw new ArgumentException("Unsupported or invalid WAV format.");

        int frames = data.Length / align;
        double duration = (double)frames / rate;
        if (duration < 0.3 || duration > 30)
            throw new ArgumentException("Use a recording between 0.3 and 30 seconds.");

        double Frame(int index)
        {
            double sum = 0;
            for (int channel = 0; channel < channels; channel++)
            {
                int offset = index * align + channel * 2;
                sum += System.Buffers.Binary.BinaryPrimitives
                    .ReadInt16LittleEndian(data.AsSpan(offset, 2)) / 32768.0;
            }
            return sum / channels;
        }

        // Resample to the detector's 16 kHz input rate.
        int count = (int)((long)frames * 16000 / rate);
        var audio = new double[count];
        for (int i = 0; i < count; i++)
        {
            double position = (double)i * rate / 16000;
            int left = Math.Min((int)position, frames - 1);
            int right = Math.Min(left + 1, frames - 1);
            double fraction = position - left;
            audio[i] = Frame(left) * (1 - fraction) + Frame(right) * fraction;
        }

        // Analyze the loudest complete window.
        int best = 0;
        double bestEnergy = -1;
        for (int start = 0; start + 4096 <= count; start += 2048)
        {
            double energy = 0;
            for (int j = 0; j < 4096; j++)
                energy += audio[start + j] * audio[start + j];
            if (energy > bestEnergy) { bestEnergy = energy; best = start; }
        }

        var window = new double[4096];
        Array.Copy(audio, best, window, 0, window.Length);
        double? frequency = PitchTest.Detect(window);
        if (frequency is null)
            return new { detected = false, message = "No clear pitch detected. Try a sustained single note." };

        int midi = (int)Math.Round(69 + 12 * Math.Log2(frequency.Value / 440));
        string[] names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        string note = names[((midi % 12) + 12) % 12] + (midi / 12 - 1);
        double reference = 440 * Math.Pow(2, (midi - 69) / 12.0);
        double cents = 1200 * Math.Log2(frequency.Value / reference);

        return new {
            detected = true, note, frequency, cents,
            duration, analyzedAtSeconds = best / 16000.0
        };
    }
}
