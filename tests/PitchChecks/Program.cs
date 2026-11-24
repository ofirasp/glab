int checks=0;
void Check(bool pass,string label){if(!pass)throw new Exception(label);checks++;}
double[] Signal(double f,double[] harmonics,double decay,int seed=1,double noise=0){
 var random=new Random(seed);double phase=random.NextDouble()*6;
 return Enumerable.Range(0,4096).Select(i=>{double t=i/16000.0;return Math.Exp(-decay*t)*harmonics.Select((v,h)=>v*Math.Sin(2*Math.PI*f*(h+1)*t+phase*(h+1))).Sum()+(random.NextDouble()-.5)*noise;}).ToArray();
}
foreach(double f in new[]{82.406889,110,146.832384,195.997718,246.941651,329.627557})
foreach(double cents in new[]{-20.0,0,20})foreach(double decay in new[]{2.0,6.0})
foreach(var harmonics in new[]{new[]{.3,.15,.07},new[]{.05,.30,.12},new[]{.03,.05,.3},new[]{.3}})
foreach(int seed in new[]{1,2}){
 double target=f*Math.Pow(2,cents/1200);var found=PitchTest.Detect(Signal(target,harmonics,decay,seed,.001));
 Check(found.HasValue&&Math.Abs(1200*Math.Log2(found.Value/target))<2,$"wrong pitch {f} cents {cents} decay {decay} harmonics {string.Join(',',harmonics)}: {found}");
}
foreach(double f in new[]{392.0,587.993154,659.255114,989.0}){
 var found=PitchTest.Detect(Signal(f,[.3],3));
 Check(found.HasValue&&Math.Abs(1200*Math.Log2(found.Value/f))<4,$"pure tone must not be folded to an open string: {f}: {found}");
}
Check(PitchTest.Detect(new double[4096]) is null,"silence rejected");
Console.WriteLine($"PASS {checks} pitch checks: six strings, detuning, decay, dominant harmonics, pure tones and silence.");
