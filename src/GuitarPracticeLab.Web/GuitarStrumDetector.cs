// Stateful attack detection over fresh microphone samples, independent of chord recognition.
public sealed class GuitarStrumDetector
{
    const double Rate=16000;
    double low,band,energy,broadband,envelope;
    long samples,last=-16000;
    public List<double> Process(ReadOnlySpan<double> input)
    {
        var attacks=new List<double>();
        long end=samples+input.Length;
        foreach(double value in input)
        {
            low+=.18*(value-low);band+=.18*(low-band);
            energy+=band*band;broadband+=value*value;samples++;
            if(samples%160!=0)continue;
            double rms=Math.Sqrt(energy/160);
            bool onset=energy>=broadband*.12&&rms>Math.Max(.012,envelope*2.8);
            energy=broadband=0;envelope=envelope*.85+rms*.15;
            if(!onset||samples-last<1440)continue;
            last=samples;attacks.Add((end-(samples-80))/Rate);
        }
        return attacks;
    }
}
