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

var songCandidates = SongChordAnalysis.Candidates(["A", "D", "E"], 0);
(double[] Chroma, double[] Bass)? SongFrame(int[] notes)
{
    var (_, chroma) = detector.Measure(Signal(notes), .003);
    return (chroma!.Select(value => value / chroma.Sum()).ToArray(), detector.BassChroma());
}
var aFrame = SongFrame([45, 52, 57, 61, 64]);
var dFrame = SongFrame([50, 57, 62, 66]);
var eFrame = SongFrame([40, 47, 52, 56, 59, 64]);
var timeline = SongChordAnalysis.BuildTimeline([aFrame, aFrame, aFrame, dFrame, dFrame, eFrame, eFrame, eFrame], songCandidates);
Check(timeline.Select(change => change.Name).SequenceEqual(["A", "D", "E"]), "a brief D survives between longer A and E sections");
Check(SongChordAnalysis.MatchLive(dFrame!.Value.Chroma, songCandidates) == "D", "live song match recognizes D");
var (_, loneNote) = detector.Measure(Signal([62]), .003);
Check(SongChordAnalysis.MatchLive(loneNote!, songCandidates) is null, "live song match rejects a single note");

var bassD = Signal([26]);
detector.Measure(bassD, .003);
var lowBass = detector.BassChroma();
Check(lowBass[2] > .55, "bass chroma includes a low D below the guitar range");

var majorSong = SongChordAnalysis.Candidates(["G", "C", "D", "Em"], 0);
var gFrame = SongFrame([43, 47, 50, 55, 59, 67]);
var cFrame = SongFrame([48, 52, 55, 60, 64]);
var maskedD = new double[12];
maskedD[2] = .23;
maskedD[4] = .34;
maskedD[6] = .09;
maskedD[9] = .06;
maskedD[1] = .07;
maskedD[7] = .05;
maskedD[5] = .16;
var softD = (maskedD, lowBass);
timeline = SongChordAnalysis.BuildTimeline(
    [gFrame, gFrame, gFrame, gFrame, softD, softD, softD, softD, softD,
        gFrame, gFrame, gFrame, gFrame, cFrame, cFrame, cFrame, cFrame,
        gFrame, gFrame, gFrame, gFrame, softD, softD, softD, softD, softD], majorSong);
Check(timeline.Select(change => change.Name).SequenceEqual(["G", "D", "G", "C", "G", "D"]),
    "neighboring frames recover short D and G changes in order");

var invertedG = new double[12];
invertedG[2] = .26; invertedG[7] = .23; invertedG[6] = .10;
invertedG[4] = .09; invertedG[11] = .08; invertedG[1] = .05; invertedG[9] = .06;
var fifthBass = new double[12];
fifthBass[2] = .66; fifthBass[7] = .32;
(double[] Chroma, double[] Bass)? gOverD = (invertedG, fifthBass);
timeline = SongChordAnalysis.BuildTimeline(
    [dFrame, dFrame, dFrame, gOverD, gOverD, gOverD, gOverD, gOverD, gOverD, gOverD, gOverD, dFrame, dFrame, dFrame],
    SongChordAnalysis.Candidates(["G", "D", "Em", "Bm", "F#7"], 0));
Check(timeline.Select(change => change.Name).SequenceEqual(["D", "G", "D"]),
    "a G chord with prominent D bass is retained between D sections");

var powers = SongChordAnalysis.Candidates(["G5","D5","A5"],0);
Check(powers.Count==3,"song matching keeps two-note power chords");
foreach(var (name,notes) in new[]{("G5",new[]{43,50,55}),("D5",new[]{50,57,62}),("A5",new[]{45,52,57})})
{
    for(int seed=1;seed<=3;seed++){
        var (_,powerChroma)=detector.Measure(Signal(notes,seed,0,true),.003);
        Check(SongChordAnalysis.MatchLive(powerChroma!,powers)==name,$"live song match recognizes {name}, seed {seed}");
    }
}
var shiftedPowers=SongChordAnalysis.Candidates(["G5","D5"],2);
var (_,shiftedPower)=detector.Measure(Signal([45,52,57]),.003);
Check(SongChordAnalysis.MatchLive(shiftedPower!,shiftedPowers)=="G5","power chord matching retains recording pitch shift");
var noFifth=new double[12];noFifth[7]=1;
Check(SongChordAnalysis.MatchLive(noFifth,powers)is null,"power chord requires fifth evidence as well as the root");

var mixedPowerCandidates=SongChordAnalysis.Candidates(["G5","G","C","D"],0);
var (_,mixedPower)=detector.Measure(Signal([43,50,55]),.003);
Check(SongChordAnalysis.MatchLive(mixedPower!,mixedPowerCandidates)=="G5","G5 remains distinct when G major is also a candidate");
var (_,fullMajor)=detector.Measure(Signal([43,47,50,55,59,67]),.003);
Check(SongChordAnalysis.MatchLive(fullMajor!,mixedPowerCandidates)=="G","full G major remains distinct from G5");
