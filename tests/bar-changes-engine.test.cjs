const assert=require('assert/strict');const Round=require('../src/GuitarPracticeLab.Web/wwwroot/bar-changes-engine.js');
const make=()=>new Round({first:'C',second:'G',bpm:120,changes:4});
let r=make();assert.equal(r.bar,2);assert.equal(r.duration,10);assert.deepEqual([0,2,4,6,8].map(t=>r.at(t).target),['C','G','C','G','C']);
assert.equal(r.at(-1),null);assert.equal(r.at(10).done,true);
assert.equal(r.observe('C',.1),false);assert.equal(r.observe('C',.25),false);assert.equal(r.result().matches,0);
assert.equal(r.observe('G',2.1),false);assert.equal(r.observe('G',2.23),true);assert.equal(r.observe('G',2.4),false);
assert.equal(r.observe('G',4.1),false);assert.equal(r.observe('C',4.2),false);assert.equal(r.observe('C',4.34),true);
r.observe('C',6.1);r.observe('C',6.25);r.observe('C',8.1);r.observe('C',8.24);
assert.equal(r.result().matches,3);assert.equal(r.result().accuracy,75);assert.equal(r.observe('G',10.1),false);
r=make();r.observe('G',1.9);assert.equal(r.observe('G',2.05),false);assert.equal(r.result().matches,0);r.observe(null,2.1);r.observe('G',2.2);assert.equal(r.observe('G',2.23),false);assert.equal(r.observe('G',2.34),true);
r=make();r.observe('G',2.1);assert.equal(r.observe('G',3),false);assert.equal(r.observe('G',3.12),true);
for(const changes of [1,2,8,128])for(const bpm of [20,30,40,60,180]){r=new Round({first:'Am',second:'D',bpm,changes});for(let i=1;i<=changes;i++){const at=i*r.bar;const c=r.at(at+.01).target;r.observe(c,at+.02);assert.equal(r.observe(c,at+.15),true);}assert.equal(r.result().matches,changes);assert.equal(r.result().accuracy,100);}
for(const args of [{first:'C',second:'C',bpm:60,changes:4},{first:'C',second:'G',bpm:0,changes:4},{first:'C',second:'G',bpm:60,changes:0}])assert.throws(()=>new Round(args));
console.log('PASS bar scheduling, initial bar exclusion, stable matches, missed bars, boundaries, duplicate rejection, tempo/count ranges and accuracy.');

for(const [meter,beats,bar] of [['3/4',3,1.5],['2/4',2,1],['6/8',6,1],['9/8',9,1.5],['12/8',12,2]]){const round=new Round({first:'C',second:'G',bpm:120,changes:2,meter});assert.equal(round.beats,beats);assert.equal(round.bar,bar);assert.equal(round.at(bar+.01).target,'G');assert.equal(round.at(bar-.01).beat,beats-1);assert.equal(round.result().meter,meter);}

// Four strums per 4/4 bar, including the starting bar; one attack per beat.
r=make();for(let beat=0;beat<20;beat++)assert.equal(r.strum(beat*.5+.01),true);
assert.equal(r.result().strumming.expected,20);assert.equal(r.result().strumming.detected,20);assert.equal(r.result().strumming.accuracy,100);
assert.equal(r.strum(9.52),false);assert.equal(r.result().strumming.extra,0);assert.equal(r.strum(9.7),false);assert.equal(r.result().strumming.extra,1);
r=make();r.strum(.01);r.strum(.70);r.strum(1.30);assert.equal(r.result().strumming.onTime,1);assert.equal(r.result().strumming.late,1);assert.equal(r.result().strumming.early,1);assert.equal(r.result().strumming.missed,17);assert.equal(r.result().strumming.accuracy,5);
assert.equal(r.strum(-.1),false);assert.equal(r.strum(10),false);
for(const meter of ['3/4','6/8','9/8','12/8']){const round=new Round({first:'C',second:'G',bpm:120,changes:2,meter});const count=round.beats*3;for(let i=0;i<count;i++)round.strum(i*round.beat+.001);assert.equal(round.result().strumming.expected,count);assert.equal(round.result().strumming.accuracy,100);}
console.log('PASS one strum per beat, early/late/missed/extra scoring, all-bar totals and compound meters');

r=make();r.strum(.11);assert.equal(r.lastStrum.status,'on-time');r.strum(.70);assert.equal(r.lastStrum.status,'late');r.strum(1.30);assert.equal(r.lastStrum.status,'early');assert.equal(r.strum(1.31),false);assert.equal(r.result().strumming.extra,0);
console.log('PASS beginner-friendly tolerance, early/late guidance and ringing/duplicate rejection');

for(const offset of [-.175,.175]){const round=make();round.strum(.5+offset);assert.equal(round.lastStrum.status,'on-time');assert.equal(round.result().strumming.toleranceMs,180);}
