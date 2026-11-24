const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot/song-library.js'),'utf8');
const start=source.indexOf('let rhythmTaps = []'),end=source.indexOf("for (const [id, factor]",start);
function setup(unit='beat',meter='4/4'){
 let now=0,status='';const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',dispatchEvent(){},addEventListener(name,callback){this[name]=callback;}});return nodes.get(id);};
 $('rhythmTapUnit').value=unit;$('rhythmMeter').value=meter;
 const context={$,performance:{now:()=>now},rhythmBeats:{'4/4':4,'6/8':2},rhythmStatus:message=>status=message,stopRhythmClicks(){},Event:function(){}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {$,tap(time,release=0){now=time;$('tapRhythmTempo').onpointerdown({isPrimary:true,button:0});now+=release;$('tapRhythmTempo').onclick();},bpm:()=>Number($('rhythmBpm').value),status:()=>status};
}
let t=setup();[0,500,1000,1600].forEach(time=>t.tap(time));
assert.equal(t.bpm(),112.5);console.log('PASS tempo averages accepted intervals instead of using the latest pair');
t=setup();[0,500,1000,2000].forEach(time=>t.tap(time));
assert.equal(t.bpm(),120);assert.ok(t.status().includes('ignored'));t.tap(2500);assert.equal(t.bpm(),120);
console.log('PASS a missed beat is excluded and the next steady tap resumes the average');
t=setup();[0,500,1000,1250,1500].forEach(time=>t.tap(time));assert.equal(t.bpm(),120);
console.log('PASS an extra early tap is excluded without shifting the beat anchor');
t=setup();[0,500,1000,1750,2000,2500].forEach(time=>t.tap(time));assert.equal(t.bpm(),120);
console.log('PASS a large off-beat deviation does not trap subsequent taps off beat');
t=setup();for(let i=0;i<30;i++)t.tap(i*500,i%2?240:40);assert.equal(t.bpm(),120);
console.log('PASS press timing ignores variable release delays');
t=setup('bar');[0,2400,4800,9600,12000].forEach(time=>t.tap(time));assert.equal(t.bpm(),100);
console.log('PASS bar taps also exclude a missed bar');
t=setup();[0,500,1000,4000,4600].forEach(time=>t.tap(time));assert.equal(t.bpm(),100);
console.log('PASS a deliberate pause starts a new tempo average');
t=setup();for(let i=0;i<30;i++)t.tap(i<20?i*500:9500+(i-19)*600);assert.equal(t.bpm(),112.3);
console.log('PASS the average includes the whole accepted sequence rather than a short rolling window');
