const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot/live-tuner.js'),'utf8');
async function tuner(string=1,initial=string){
 let now=0,receive;const nodes=new Map(),events={};
 function element(){const classes=new Set();return {children:[],style:{},dataset:{},value:'mic',textContent:'',classList:{contains:n=>classes.has(n),add:n=>classes.add(n),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle(n,on){if(on)classes.add(n);else classes.delete(n);}},setAttribute(){},removeAttribute(){},add(){},addEventListener(){}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 $('strings').children=Array.from({length:6},element);
 const c={$ ,console,selected:initial,names:['E2','A2','D3','G3','B3','E4'],freqs:[82.4069,110,146.8324,195.9977,246.9417,329.6276],ctx:null,toneOsc:null,
  performance:{now:()=>now},currentPage:'tuner',document:{hidden:false,addEventListener:(n,cb)=>events[n]=cb},
  Option:function(){},AbortController,setTimeout,stopTone(){},update(){},audio:async()=>{},sound(){},addEventListener(){},
  PiMicrophone:{guitarTunings:{standard:{label:'Standard',notes:[40,45,50,55,59,64]}},async load(){return {available:true};},
   noteName:()=>'',midi:f=>69+12*Math.log2(f/440),remember(){},listen(device,signal,callback){receive=callback;return new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}}};
 c.window=c;vm.createContext(c);vm.runInContext(script,c);await new Promise(resolve=>setImmediate(resolve));
 const frequency=(time,value)=>{now=time;receive(value);};
 const reading=(time,cents=0)=>frequency(time,cents===null?null:c.freqs[string]*2**(cents/1200));
 return {$,reading,frequency,selected:()=>c.selected,green:()=>$('strings').children[string].classList.contains('string-in-tune'),reset:()=>events['guitar-tuner-string']()};
}
(async()=>{
 let t=await tuner();t.reading(0);t.reading(256);assert.equal(t.green(),false);assert.equal(t.$('tuning').textContent,'Centered · checking…');
 t.reading(512);assert.equal(t.green(),true);console.log('PASS three accurate readings over half a second confirm a short ringing note');
 t=await tuner();for(let i=0;i<30;i++)t.reading(i*10);assert.equal(t.green(),false);console.log('PASS buffered bursts cannot fake elapsed listening time');
 t=await tuner();for(let i=0;i<12;i++)t.reading(i*256,i%2?4:-4);assert.equal(t.green(),false);console.log('PASS wavering pitch still fails stability');
 t=await tuner();t.reading(0);t.reading(256);t.reading(512,null);t.reading(768,null);t.reading(1024);assert.equal(t.green(),true);console.log('PASS brief note dropouts preserve accurate pitch evidence');
 t=await tuner();t.reading(0);t.reading(256);t.reading(1600,null);t.reading(1856);t.reading(2112);assert.equal(t.green(),false);t.reading(2368);assert.equal(t.green(),true);console.log('PASS a long fade requires fresh confirmation');
 t=await tuner();t.reading(0);t.reading(256);t.reading(1600);assert.equal(t.green(),false);console.log('PASS missing frames cannot confirm stale evidence');
 t=await tuner();for(let i=0;i<3;i++)t.reading(i*256);t.reading(768,null);assert.equal(t.green(),true);assert.match(t.$('tuning').textContent,/In tune/);assert.match(t.$('tunerLastScore').textContent,/Confirmed · A2 · 100%/);
 t.reset();assert.equal(t.green(),false);t.reading(2000);t.reading(2256);assert.equal(t.green(),false);t.reading(2512);assert.equal(t.green(),true);console.log('PASS green strings stay visibly confirmed through silence until tapped');
 for(const string of [3,5]){
  t=await tuner(string);for(const [i,cents]of [-1,1,0].entries())t.reading(i*256,cents);assert.equal(t.green(),true);
  t=await tuner(string);for(let i=0;i<20;i++)t.reading(i*256,7);assert.equal(t.green(),false);
 }
 console.log('PASS G and high E confirm short accurate notes and reject sustained detuning');
 t=await tuner();t.reading(0,15);t.reading(256,15);const left=t.$('needle').style.left;t.reading(512,null);assert.equal(t.$('needle').style.left,left);assert.equal(t.$('needle').classList.contains('waiting'),true);assert.match(t.$('tuning').textContent,/Pluck string/);console.log('PASS a faded note dims the last needle position instead of falsely centering it');
 t=await tuner();t.reading(0,-20);assert.match(t.$('tuning').textContent,/Tighten string 5.*flat/);t=await tuner();t.reading(0,20);assert.match(t.$('tuning').textContent,/Loosen string 5.*sharp/);console.log('PASS flat and sharp notes explain which way to adjust');
 t=await tuner(5);t.reading(0,10);t.reading(256,10);t.reading(512,70);assert.ok(Math.abs(parseFloat(t.$('needle').style.left)-60)<.1);assert.equal(t.green(),false);console.log('PASS isolated display spikes are filtered');
 t=await tuner(5);t.reading(0,7);t.frequency(256,110);assert.equal(t.selected(),5);assert.match(t.$('freq').textContent,/Checking A2/);t.reading(512,7);assert.equal(t.selected(),5);t.frequency(768,45);assert.equal(t.selected(),5);console.log('PASS Auto ignores isolated other-string frames and pitches outside the guitar range');
 t=await tuner(5,0);t.reading(0);assert.equal(t.selected(),0);t.reading(256);assert.equal(t.selected(),5);t.reading(512);t.reading(768);assert.equal(t.green(),true);console.log('PASS Auto changes string after two consistent readings');
})().catch(error=>{console.error(error);process.exitCode=1;});
