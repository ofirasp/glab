static List<double> Detect(double[] signal){var detector=new GuitarStrumDetector();var events=new List<double>();for(int i=0;i<signal.Length;i+=2048){int size=Math.Min(2048,signal.Length-i);events.AddRange(detector.Process(signal.AsSpan(i,size)).Select(age=>(i+size)/16000.0-age));}return events;}
var plucks=new double[40000];
foreach(double attack in new[]{.2,.7,1.2,1.7})for(int i=(int)(attack*16000);i<plucks.Length;i++){double t=i/16000.0-attack;plucks[i]+=.35*Math.Exp(-14*t)*(Math.Sin(2*Math.PI*110*t)+.4*Math.Sin(2*Math.PI*220*t));}
var found=Detect(plucks);if(found.Count!=4)throw new Exception($"Expected four plucks, found {found.Count}");
for(int i=0;i<4;i++)if(Math.Abs(found[i]-(.2+i*.5))>.04)throw new Exception("Attack timing inaccurate");
var clicks=new double[40000];foreach(double attack in new[]{.2,.7,1.2,1.7})for(int i=(int)(attack*16000);i<Math.Min(clicks.Length,(int)((attack+.045)*16000));i++)clicks[i]=.5*Math.Sin(2*Math.PI*2400*i/16000.0);
if(Detect(clicks).Count!=0)throw new Exception("Metronome counted as guitar");
if(Detect(new double[16000]).Count!=0)throw new Exception("Silence counted as guitar");
Console.WriteLine("PASS four pluck attacks, streaming chunk boundaries, timing, metronome rejection and silence");

var quiet=new double[32000];foreach(double attack in new[]{.2,.7,1.2})for(int i=(int)(attack*16000);i<Math.Min(quiet.Length,(int)((attack+.04)*16000));i++)quiet[i]=.015*Math.Sin(2*Math.PI*110*i/16000.0);
if(Detect(quiet).Count!=0)throw new Exception("Quiet bumps counted as guitar");
Console.WriteLine("PASS low-level guitar-band noise ignored with reduced sensitivity");
