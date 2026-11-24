const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const elements=new Map(),storage=new Map(),audioEvents={};let receiver;
const $=id=>{
 if(!elements.has(id))elements.set(id,{textContent:'',value:id==='chordMatchDevice'?'mic':'',hidden:true,open:false,
  classList:{toggle(){}},style:{setProperty(){}},setAttribute(){}});
 return elements.get(id);
};
const audio={paused:true,seeking:false,currentTime:0,playbackRate:1,addEventListener(name,callback){audioEvents[name]=callback;},pause(){this.paused=true;audioEvents.pause?.();}};
const analysis={shift:0,changes:[{time:0,name:'G'},{time:4,name:'C'}]};
const context={console,$,audio,song:{id:'test',audioVersion:'audio'},document:{hidden:false,addEventListener(){}},
 activeChordAnalysis:()=>analysis,playbackChord:name=>name,chordIndexAt:time=>time>=4?1:0,
 localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},AbortController,
 takingSongRecording:false,looping:false,
 openDialog:id=>{$(id).open=true;},closeDialog:id=>{$(id).open=false;},
 status(){},message:error=>{throw error;},startSongPlayback:async()=>{audio.paused=false;return true;},
 PiMicrophone:{async load(){return {available:true};},remember(){},listenChords(device,names,shift,signal,receive){
  receiver=receive;return new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
 }},addEventListener(){}};
context.window=context;vm.createContext(context);
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
for(const file of ['chord-change-timing.js','song-chord-match.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function start(){audio.currentTime=0;receiver=null;$('startChordMatch').onclick();await flush();assert.ok(receiver);}
function sample(chord,centre){audio.currentTime=centre+.128;receiver(chord,{ageSeconds:.128});}
async function end(){audio.paused=true;audioEvents.ended();await flush();}
(async()=>{
 await start();sample('G',.2);sample('G',.328);sample('C',4);sample('C',4.128);
 assert.equal($('chordTimingFeedback').textContent,'On time ✓');
 await end();
 let last=JSON.parse([...storage].find(([key])=>key.endsWith('-last'))[1]);
 assert.equal(last.percent,100);assert.equal(last.timing.percent,100);
 assert.ok($('chordTimingBest').textContent.includes('100%'));
 console.log('PASS latency-adjusted timing and chord accuracy save as separate scores');
 await start();sample('G',.2);sample('G',.328);sample('C',4.575);sample('C',4.703);
 assert.ok($('chordTimingFeedback').textContent.startsWith('Late'));
 await end();
 last=JSON.parse([...storage].find(([key])=>key.endsWith('-last'))[1]);
 assert.equal(last.percent,100);assert.equal(last.timing.percent,50);
 assert.ok($('chordTimingLast').textContent.includes('50%'));
 assert.ok($('chordTimingBest').textContent.includes('100%'));
 console.log('PASS late changes reduce only timing; timing best survives reopening');
 await start();sample('G',.2);sample('G',.328);await end();
 last=JSON.parse([...storage].find(([key])=>key.endsWith('-last'))[1]);
 assert.equal(last.percent,50);assert.equal(last.timing.percent,0);assert.equal(last.timing.missed,1);
 console.log('PASS missed changes count against timing independently of correct opening chord');
 const previousLast=[...storage].find(([key])=>key.endsWith('-last'))[1];
 await start();await end();
 assert.equal($('matchTimingPercent').textContent,'—');assert.equal($('matchTimingDetail').textContent,'No timing readings');
 assert.equal([...storage].find(([key])=>key.endsWith('-last'))[1],previousLast);
 console.log('PASS no microphone readings cannot replace saved scores');
 const bestKey=[...storage.keys()].find(key=>key.endsWith('-timing-best-v1'));
 storage.set(bestKey,JSON.stringify({percent:50}));
 await start();audioEvents.seeking();sample('G',.2);sample('G',.328);sample('C',4);sample('C',4.128);await end();
 assert.equal(JSON.parse(storage.get(bestKey)).percent,50);
 assert.ok($('chordMatchResult').textContent.includes('excludes it from your personal best'));
 console.log('PASS seeking cannot improve the timing personal best');
 const lastKey=[...storage.keys()].find(key=>key.endsWith('-last'));
 storage.set(lastKey,JSON.stringify({hits:1,total:2,percent:50}));
 $('chordMatchButton').onclick();await flush();
 assert.equal($('chordMatchLast').textContent,'Last score · 50% (1 / 2)');
 assert.equal($('chordTimingLast').textContent,'');
 console.log('PASS older chord-only scores remain readable');
 context.GuitarTimingAdjustment={get:()=>140};
 await start();sample('G',.34);sample('G',.468);sample('C',4.14);sample('C',4.268);await end();
 const correctedKey=[...storage.keys()].find(key=>key.endsWith('-offset-140-last'));
 const corrected=JSON.parse(storage.get(correctedKey));
 assert.equal(corrected.percent,100);assert.equal(corrected.timing.percent,100);assert.equal(corrected.timing.averageMs,0);
 console.log('PASS microphone correction adjusts timing and keeps calibrated scores separate');
})().catch(error=>{console.error(error);process.exitCode=1;});
