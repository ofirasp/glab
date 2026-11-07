const assert=require('node:assert/strict'),S=require('../src/GuitarPracticeLab.Web/wwwroot/scales.js');
for(let root=0;root<12;root++)for(const type of Object.keys(S.patterns)){
 const scale=S.build(root,type),allowed=S.patterns[type].intervals;
 assert.ok(scale.notes.every(n=>allowed.includes((n.pc-root+12)%12)),'Every fret is in the selected scale');
 assert.ok(scale.notes.every(n=>n.fret>=0&&n.fret<=24),'Frets are playable');
 const up=scale.ascending;assert.equal(up[0].pc,root);assert.equal(up.at(-1).pc,root);assert.equal(up.at(-1).midi-up[0].midi,24);
 assert.ok(up.every((n,i)=>!i||n.midi>up[i-1].midi),'Ascending pitches');
 const both=S.sequence(scale,'both');assert.equal(both.length,up.length*2-2);
 assert.ok(both.every((n,i)=>n.midi!==both[(i+1)%both.length].midi),'No repeated turnaround or loop endpoint');
 assert.deepEqual(S.sequence(scale,'down'),[...up].reverse());
}
assert.ok(S.build(4,'major').notes.some(n=>n.name==='G♯'));assert.ok(!S.build(4,'major').notes.some(n=>n.name==='A♭'));
assert.ok(S.build(1,'major').notes.some(n=>n.name==='E♯'));assert.ok(S.build(5,'major').notes.some(n=>n.name==='B♭'));
assert.throws(()=>S.build(12,'major'));assert.throws(()=>S.build(0,'other'));
console.log('PASS 24 key/scale combinations, interval membership, frets, two-octave sequences and loop turnarounds');

const open=S.build(0,'major','open');
assert.deepEqual(open.notes.map(n=>n.midi),[40,41,43,45,47,48,50,52,53,55,57,59,60,62,64,65,67]);
const loop=S.sequence(open,'both');
assert.deepEqual(loop.map(n=>n.midi),[48,50,52,53,55,57,59,60,62,64,65,67,65,64,62,60,59,57,55,53,52,50,48,47,45,43,41,40,41,43,45,47]);
assert.deepEqual(S.sequence(open,'down'),[...open.notes].reverse());
assert.equal(S.build(7,'major','open').open,false);
console.log('PASS open C major positions and practice sequence');
