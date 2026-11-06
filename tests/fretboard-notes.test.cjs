const assert=require('node:assert/strict'),F=require('../src/GuitarPracticeLab.Web/wwwroot/fretboard-notes.js'),S=require('../src/GuitarPracticeLab.Web/wwwroot/scales.js');
for(let first=0;first<=20;first+=5)for(let root=0;root<12;root++)for(const type of ['',...Object.keys(S.patterns)]){
 const notes=F.windowNotes(first,root,type,true);assert.equal(notes.length,30);
 for(const n of notes){assert.ok(n.fret>=first&&n.fret<first+5);assert.equal(n.pc,n.midi%12);assert.equal(n.root,n.pc===root);if(type)assert.equal(n.inScale,S.patterns[type].intervals.includes((n.pc-root+12)%12));}
 const target=F.choose(notes,null,()=>0);assert.ok(F.candidates(notes).some(n=>n.pc===target));assert.notEqual(F.choose(notes,target,()=>0),target);
}
const open=F.windowNotes(0);assert.deepEqual(open.filter(n=>n.fret===0).map(n=>n.name),['E','A','D','G','B','E']);assert.ok(open.filter(n=>n.visible).every(n=>!n.name.includes('♯')&&!n.name.includes('♭')));
assert.equal(F.windowNotes(10,0,'major',true).find(n=>n.string===0&&n.fret===12).pc,4);
assert.ok(F.windowNotes(0,4,'major').some(n=>n.name==='G♯'&&n.inScale));assert.equal(F.windowNotes(0,9,'minorPentatonic').find(n=>n.name==='C').interval,'♭3');
assert.throws(()=>F.windowNotes(21));console.log('PASS 180 fret-range/key/filter combinations, standard tuning, octaves, intervals, spellings and answer selection');
