using System.Diagnostics;
static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
var detector=new ChordDetector();
double[] Signal(int[] midis,int seed=1,double cents=0,bool noise=false) {
 var random=new Random(seed);var phase=midis.Select(_=>random.NextDouble()*6).ToArray();var result=new double[ChordDetector.Size];
 for(int i=0;i<result.Length;i++){
  double time=(double)i/ChordDetector.Rate;
  for(int n=0;n<midis.Length;n++)for(int h=1;h<=7;h++)result[i]+=.045*Math.Sin(2*Math.PI*440*Math.Pow(2,(midis[n]-69+cents/100)/12.0)*h*time+phase[n])/(Math.Pow(h,1.25)*Math.Sqrt(midis.Length));
  if(noise)result[i]+=(random.NextDouble()-.5)*.003;
 }
 return result;
}
var pairs=new[]{("C","G",new[]{48,52,55,60,64},new[]{43,47,50,55,59,67}), ("Am","D",new[]{45,52,57,60,64},new[]{50,57,62,66}), ("Em","A",new[]{40,47,52,55,59,64},new[]{45,52,57,61,64}), ("F","Bm",new[]{41,48,53,57,60,65},new[]{47,54,59,62,66}), ("C","C7",new[]{48,52,55,60,64},new[]{48,52,58,60,64}), ("C","Cmaj7",new[]{48,52,55,60,64},new[]{48,52,55,59,64}), ("Am","Am7",new[]{45,52,57,60,64},new[]{45,52,55,60,64}), ("D","Dsus2",new[]{50,57,62,66},new[]{50,57,62,64})};
var clock=Stopwatch.StartNew();int frames=0;
foreach(var(a,b,ma,mb)in pairs)for(int seed=1;seed<=3;seed++)foreach(double cents in new[]{-12.0,0,12}){
 var first=GuitarChord.Parse(a);var second=GuitarChord.Parse(b);
 var x=detector.Analyze(Signal(ma,seed,cents,true),first,second);Check(x.Name==a,$"polyphonic {a} vs {b}, seed {seed}, tuning {cents}");
 var y=detector.Analyze(Signal(mb,seed,cents,true),first,second);Check(y.Name==b,$"polyphonic {b} vs {a}, seed {seed}, tuning {cents}");frames+=2;
}
Check(detector.Analyze(new double[ChordDetector.Size],GuitarChord.Parse("C"),GuitarChord.Parse("G")).Name is null,"silence is not counted");
Check(detector.Analyze(Signal([60]),GuitarChord.Parse("C"),GuitarChord.Parse("G")).Name is null,"single note is not a chord");
Check(detector.Analyze(Signal([50,57,62,66]),GuitarChord.Parse("C"),GuitarChord.Parse("G")).Name is null,"unrelated chord is rejected");
var round=new OneMinuteRound("C","G");
Check(!round.Observe("C",0)&&round.Observe("C",.13)&&round.Count==1&&round.Target=="G","stable first chord counts and alternates");
for(int i=0;i<20;i++)round.Observe("C",1+i*.13);
Check(round.Count==1,"holding and restrumming previous chord cannot add counts");
Check(!round.Observe("G",4)&&round.Observe("G",4.13)&&round.Count==2&&round.Changes==1,"next stable chord counts as a change");
Check(!round.Observe("C",59.9)&&!round.Observe("C",60)&&round.Count==2,"no count at or after sixty seconds");
try{_ = new OneMinuteRound("C#","Db");throw new Exception("accepted equivalent chord");}catch(ArgumentException){Console.WriteLine("PASS equivalent chord names rejected");}
try{_ = new OneMinuteRound("Am7","C6");throw new Exception("accepted identical notes");}catch(ArgumentException){Console.WriteLine("PASS indistinguishable note sets rejected");}
Console.WriteLine($"{frames} polyphonic frames in {clock.Elapsed.TotalMilliseconds:F0} ms. Synthetic tests do not establish real microphone accuracy.");

var noise=new Random(123);Check(detector.Analyze(Enumerable.Range(0,ChordDetector.Size).Select(_=>(noise.NextDouble()-.5)*.12).ToArray(),GuitarChord.Parse("C"),GuitarChord.Parse("G")).Name is null,"broadband noise rejected");
var input=Signal([48,52,55,60,64]);var bench=Stopwatch.StartNew();for(int i=0;i<50;i++)detector.Analyze(input,GuitarChord.Parse("C"),GuitarChord.Parse("G"));Console.WriteLine($"Detector-only average on this Mac: {bench.Elapsed.TotalMilliseconds/50:F2} ms/frame (Pi timing not measured).");
