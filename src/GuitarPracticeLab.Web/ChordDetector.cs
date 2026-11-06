using System.Numerics;
using System.Text.RegularExpressions;

public sealed record GuitarChord(string Name, int[] Notes, int[] Required)
{
    static readonly Dictionary<string, int[]> Qualities = new() {
        [""]=[0,4,7], ["m"]=[0,3,7], ["5"]=[0,7], ["7"]=[0,4,7,10], ["maj7"]=[0,4,7,11],
        ["m7"]=[0,3,7,10], ["sus2"]=[0,2,7], ["sus4"]=[0,5,7], ["dim"]=[0,3,6], ["aug"]=[0,4,8],
        ["dim7"]=[0,3,6,9], ["m7b5"]=[0,3,6,10], ["6"]=[0,4,7,9], ["m6"]=[0,3,7,9],
        ["add9"]=[0,2,4,7], ["madd9"]=[0,2,3,7], ["6add9"]=[0,2,4,7,9],
        ["9"]=[0,2,4,7,10], ["m9"]=[0,2,3,7,10], ["maj9"]=[0,2,4,7,11],
        ["7sus4"]=[0,5,7,10], ["7sus2"]=[0,2,7,10], ["7b5"]=[0,4,6,10], ["7#5"]=[0,4,8,10], ["7b9"]=[0,1,4,7,10], ["7#9"]=[0,3,4,7,10]
    };
    public static GuitarChord Parse(string name)
    {
        var m=Regex.Match(name ?? "", @"^([A-G])([#b]?)(.*)$");
        if(!m.Success || !Qualities.TryGetValue(m.Groups[3].Value, out var notes)) throw new ArgumentException("Choose a supported chord name.");
        int root="C D EF G A B".IndexOf(m.Groups[1].Value, StringComparison.Ordinal);
        root=(root+(m.Groups[2].Value=="#"?1:m.Groups[2].Value=="b"?-1:0)+12)%12;
        return new(name!,notes.Select(n=>(n+root)%12).Order().ToArray(),notes.Where(n=>notes.Length<4||n!=7).Select(n=>(n+root)%12).ToArray());
    }
}

// Polyphonic template fitting, rather than the tuner's single-note detector.
// Harmonic note templates are fit by non-negative least squares before pitch-class matching.
public sealed class ChordDetector
{
    public const int Rate=16000, Size=8192, Hop=2048;
    const int FirstMidi=40, Count=45, Bins=1300;
    readonly double[][] templates=new double[Count][];
    readonly double[,] gram=new double[Count,Count];
    readonly double[] hann=new double[Size], weights=new double[Bins];
    readonly Complex[] fft=new Complex[Size];
    public ChordDetector()
    {
        for(int i=0;i<Size;i++) hann[i]=.5-.5*Math.Cos(2*Math.PI*i/(Size-1));
        for(int i=0;i<Bins;i++) weights[i]=1/Math.Sqrt(Math.Max(70,i*(double)Rate/Size));
        for(int n=0;n<Count;n++) {
            var t=templates[n]=new double[Bins];double f=440*Math.Pow(2,(FirstMidi+n-69)/12.0);
            for(int h=1;h<=7;h++) {
                double bin=f*h*Size/Rate;
                for(int k=Math.Max(1,(int)bin-4);k<Math.Min(Bins,(int)bin+5);k++)
                    t[k]+=Math.Exp(-.5*Math.Pow((k-bin)/.85,2))*weights[k]/Math.Pow(h,1.25);
            }
            double norm=Math.Sqrt(t.Sum(v=>v*v));for(int k=0;k<Bins;k++)t[k]/=norm;
        }
        for(int i=0;i<Count;i++)for(int j=0;j<Count;j++)for(int k=0;k<Bins;k++)gram[i,j]+=templates[i][k]*templates[j][k];
    }
    public sealed record Reading(string? Name, double Rms, double Confidence);
    public Reading Analyze(double[] samples, GuitarChord first, GuitarChord second, double noiseFloor=.003)
    {
        if(samples.Length!=Size)throw new ArgumentException("Expected a complete audio window.");
        double rms=Math.Sqrt(samples.Sum(v=>v*v)/Size);
        if(rms<noiseFloor)return new(null,rms,0);
        double mean=samples.Average();for(int i=0;i<Size;i++)fft[i]=new((samples[i]-mean)*hann[i],0);
        for(int i=1,j=0;i<Size;i++){int bit=Size>>1;for(;(j&bit)!=0;bit>>=1)j^=bit;j^=bit;if(i<j)(fft[i],fft[j])=(fft[j],fft[i]);}
        for(int len=2;len<=Size;len<<=1){var step=Complex.FromPolarCoordinates(1,-2*Math.PI/len);for(int i=0;i<Size;i+=len){Complex w=1;for(int j=0;j<len/2;j++){var u=fft[i+j];var v=fft[i+j+len/2]*w;fft[i+j]=u+v;fft[i+j+len/2]=u-v;w*=step;}}}
        var spectrum=new double[Bins];for(int k=1;k<Bins;k++)spectrum[k]=fft[k].Magnitude*weights[k];
        var residual=new double[Count];var amplitudes=new double[Count];
        for(int i=0;i<Count;i++)for(int k=1;k<Bins;k++)residual[i]+=templates[i][k]*spectrum[k];
        for(int pass=0;pass<22;pass++)for(int i=0;i<Count;i++){
            double next=Math.Max(0,amplitudes[i]+residual[i]/gram[i,i]),delta=next-amplitudes[i];amplitudes[i]=next;
            for(int j=0;j<Count;j++)residual[j]-=gram[j,i]*delta;
        }
        var chroma=new double[12];for(int i=0;i<Count;i++)chroma[(FirstMidi+i)%12]+=amplitudes[i];
        double total=chroma.Sum(), peak=chroma.Max();if(total<1e-9)return new(null,rms,0);
        double Score(GuitarChord c)=>c.Notes.Sum(n=>chroma[n])/total;
        bool Complete(GuitarChord c)=>c.Required.All(n=>chroma[n]>=peak*.10);
        double a=Complete(first)?Score(first):-1,b=Complete(second)?Score(second):-1;
        if(a>=.82 && a-b>=.10 && Complete(first))return new(first.Name,rms,a);
        if(b>=.82 && b-a>=.10 && Complete(second))return new(second.Name,rms,b);
        return new(null,rms,Math.Max(0,Math.Max(a,b)));
    }
}

public sealed class OneMinuteRound
{
    public const double Duration=60;
    public string First {get;} public string Second {get;}
    public int Count {get;private set;}
    public string Target => Count%2==0?First:Second;
    public int Changes => Math.Max(0,Count-1);
    string? candidate;int stable;
    public OneMinuteRound(string first,string second) {
        var a=GuitarChord.Parse(first);var b=GuitarChord.Parse(second);
        if(a.Notes.SequenceEqual(b.Notes))throw new ArgumentException("Choose two chords with different notes. Enharmonic names and equivalent note sets cannot be distinguished reliably.");
        First=first;Second=second;
    }
    public bool Observe(string? name,double seconds) {
        if(seconds<0 || seconds>=Duration)return false;
        if(name!=Target){candidate=null;stable=0;return false;}
        stable=candidate==name?stable+1:1;candidate=name;
        if(stable<2)return false;
        Count++;candidate=null;stable=0;return true;
    }
}
