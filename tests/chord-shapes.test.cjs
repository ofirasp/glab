const assert = require('node:assert/strict');
require('../src/GuitarPracticeLab.Web/wwwroot/chord-shapes.js');
const roots=['C','C#','Db','D','D#','Eb','E','F','F#','Gb','G','G#','Ab','A','A#','Bb','B'];
const qualities=['','m','7','maj7','m7','sus2','sus4','dim','dim7','aug','6','m6','add9','9','m7b5','6add9'];
let voicings=0;
for(const r of roots)for(const q of qualities){const n=r+q,c=GuitarChords.parse(n),shapes=GuitarChords.shapes(n);assert.ok(shapes.length,n);for(const s of shapes){assert.ok(GuitarChords.valid(s.frets,c),n);assert.ok(s.labels.every(f=>f===null||(f>=1&&f<=4)),n);voicings++;}}
for(const n of ['C/G','D/F#','Am/G','Bb/D'])assert.ok(GuitarChords.shapes(n).length,n);
for(const n of ['<script>','Hm','Cunknown'])assert.equal(GuitarChords.shapes(n).length,0,n);
assert.deepEqual(GuitarChords.shapes('C')[0].frets,[-1,3,2,0,1,0]);
assert.equal(GuitarChords.parse('F♯min7').root,6);
assert.deepEqual(GuitarChords.parse('Db').notes,GuitarChords.parse('C#').notes);
console.log(`${roots.length*qualities.length} chord names, ${voicings} pitch-checked voicings passed.`);

const twoFingerG=GuitarChords.shapes('G').find(shape=>shape.frets.join(',')==='3,-1,0,0,0,3');
assert.deepEqual(twoFingerG?.labels,[2,null,null,null,null,3]);
