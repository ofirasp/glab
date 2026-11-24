const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('src/GuitarPracticeLab.Web/wwwroot/mic-practice.js','utf8');
const functions=source.slice(source.indexOf('  function timingResults('),source.indexOf("  el('strumResultClose')"));
const show=source.slice(source.indexOf('  function showTiming('),source.indexOf('  async function strum('));
function fixture(store=new Map()){
 const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'',classList:{toggle(){}},showModal(){this.open=true;},setAttribute(){}});return nodes.get(id);};
 el('tempo').value='120';el('beatMode').value='visual';
 const ctx={GuitarStrumTiming:require('../src/GuitarPracticeLab.Web/wwwroot/guitar-strum-timing.js'),el,beats:Array.from({length:32},()=>({setAttribute(){}})),localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},renderTimingReview(){},timingCelebration(){ctx.celebrations++;},celebrations:0,say(){}};
 vm.createContext(ctx);vm.runInContext(functions+show,ctx);return {ctx,el,store};
}
const counts=n=>({'on-time':n,early:0,late:0,missed:32-n});
let f=fixture();f.ctx.timingResults(counts(31),2);
assert.equal(f.el('strumScore').textContent,'97%');assert.equal(f.el('changesRoundTitle').textContent,'New personal best!');assert.equal(f.ctx.celebrations,1);assert.match(f.el('changesRoundSave').textContent,/2 extra/);
f.ctx.timingResults(counts(31),0);assert.equal(f.ctx.celebrations,1);assert.equal(f.el('changesRoundTitle').textContent,'Personal best matched!');
f.ctx.timingResults(counts(16),0);assert.equal(f.el('strumLast').textContent,'97%');assert.equal(f.el('changesRoundDifference').textContent,'-47 pts');assert.equal(f.el('changesRoundBest').textContent,'97%');assert.equal(f.ctx.celebrations,1);
f.el('tempo').value='60';f.ctx.timingResults(counts(16),0);assert.equal(f.el('strumLast').textContent,'—');assert.equal(f.el('changesRoundBest').textContent,'50%');
f.el('beatMode').value='audio';f.ctx.timingResults(counts(0),0);assert.equal(f.el('strumLast').textContent,'—');assert.equal(f.el('changesRoundTitle').textContent,'Round complete');assert.equal(f.ctx.celebrations,2);
const restored=fixture(f.store);restored.ctx.timingResults(counts(20),0);assert.equal(restored.el('strumLast').textContent,'50%');assert.equal(restored.el('changesRoundBest').textContent,'97%');
f=fixture();f.ctx.localStorage.setItem=()=>{throw Error('storage full');};f.ctx.timingResults(counts(32),0);assert.equal(f.ctx.celebrations,0);assert.match(f.el('changesRoundSave').textContent,/Could not save/);assert.equal(f.el('changesRoundBest').textContent,'—');
f=fixture();f.ctx.showTiming([...Array(8).fill(0),...Array(8).fill(-.12),...Array(8).fill(.15),...Array(8).fill(null)],0);assert.equal(f.el('strumScore').textContent,'25%');for(const id of ['strumOnTime','strumEarly','strumLate','strumMissed'])assert.equal(f.el(id).textContent,8);
console.log('PASS Strumming results: accuracy, breakdown, first/best/tied/lower scores, tempo/mode isolation, persistence and save failure.');
