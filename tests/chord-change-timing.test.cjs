const assert = require('node:assert/strict');
require('../src/GuitarPracticeLab.Web/wwwroot/chord-change-timing.js');
const timeline = [{time:0,name:'G'},{time:4,name:'C'},{time:8,name:'D'}];
const stable=(timing,name,time)=>{timing.observe(name,time);return timing.observe(name,time+.128);};
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS',name);}
check('stable changes receive independent on-time and late feedback',()=>{
 const t=ChordChangeTiming.create(timeline);
 assert.equal(stable(t,'G',0),null);
 assert.equal(stable(t,'C',4.1).label,'On time ✓');
 assert.equal(stable(t,'D',8.575).label,'Late');
 const result=t.result();
 assert.equal(result.percent,75);assert.equal(result.total,2);assert.equal(result.detected,2);assert.equal(result.missed,0);
 assert.ok(Math.abs(result.averageMs-338)<=1);assert.ok(Math.abs(result.averageErrorMs-338)<=1);
});
check('early changes use the first reading rather than confirmation time',()=>{
 const t=ChordChangeTiming.create(timeline);
 stable(t,'G',0);
 const f=stable(t,'C',3.7);
 assert.equal(f.label,'Early');assert.ok(Math.abs(f.offset+.3)<1e-9);
});
check('missed changes count as zero instead of disappearing from the denominator',()=>{
 const t=ChordChangeTiming.create(timeline);stable(t,'G',0);stable(t,'D',8);
 assert.equal(t.result().percent,50);assert.equal(t.result().missed,1);
});
check('isolated or null detections cannot score a change',()=>{
 const t=ChordChangeTiming.create(timeline);stable(t,'G',0);
 t.observe('C',4);t.observe(null,4.128);t.observe('C',4.256);
 assert.equal(t.result().detected,0);
});
check('repeated strums and duplicate packets cannot add timing hits',()=>{
 const t=ChordChangeTiming.create(timeline);stable(t,'G',0);stable(t,'C',4);
 for(let i=0;i<10;i++)t.observe('C',4.5+i*.128);
 t.observe('D',8);t.observe('D',8);
 assert.equal(t.result().detected,1);
});
check('repeated timeline names, including alternate chords, are not new changes',()=>{
 const t=ChordChangeTiming.create([{time:0,name:'G'},{time:2,name:null},{time:4,name:'G'},{time:8,name:'C'}],n=>n==='C'?'G':n);
 assert.equal(t.result().total,0);assert.equal(t.result().percent,null);
});
check('a late change cannot be mistaken for a later repetition of the chord',()=>{
 const t=ChordChangeTiming.create([...timeline,{time:12,name:'C'}]);
 stable(t,'G',0);stable(t,'C',6.5);
 assert.equal(t.result().detected,0);
});
check('pause resets a pending detection without deleting scores',()=>{
 const t=ChordChangeTiming.create(timeline);stable(t,'G',0);stable(t,'C',4);
 t.observe('D',7.9);t.resetInput();t.observe('D',8.1);
 assert.equal(t.result().detected,1);
});
check('timing offsets account for slower playback',()=>{
 const t=ChordChangeTiming.create(timeline);stable(t,'G',0);
 t.observe('C',4.1,.5);
 const f=t.observe('C',4.228,.5);
 assert.equal(f.label,'Late');assert.ok(Math.abs(f.offset-.2)<1e-9);
});
console.log(`${checks} timing checks passed.`);
