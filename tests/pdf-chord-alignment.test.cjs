const assert=require('assert/strict'),a=require('../src/GuitarPracticeLab.Web/wwwroot/pdf-chord-alignment.js');
const names=['G','C','D','G','Em','C','D','G'];const hits=names.map((name,i)=>({name,key:'1:'+i,page:1,x:.1,y:i/10,width:.04,height:.01}));const changes=names.map((name,i)=>({name,time:i*4}));
let result=a.align(changes,hits);assert.deepEqual(result.map(r=>r.hit.key),hits.map(h=>h.key));assert.ok(result.every(r=>r.confident));
result=a.align([{name:'X',time:0},{name:'D',time:3}],hits);assert.equal(result[0].hit,null);
result=a.align([{name:'G',time:0}],hits);assert.equal(result[0].confident,false);result=a.align([{name:'G',time:0}],hits,{0:'1:7'});assert.equal(result[0].hit.key,'1:7');assert.equal(result[0].confident,true);
assert.equal(a.normalize('F♯m'),a.normalize('Gbm'));assert.notEqual(a.normalize('G'),a.normalize('G5'));
const repeated=a.align([...changes,...changes.map(c=>({...c,time:c.time+32}))],hits,{8:'1:0'});assert.equal(repeated[8].hit.key,'1:0');assert.equal(repeated.length,16);
const edited=[{name:'G',time:0},{name:'D',time:2.23},{name:'C',time:4}];assert.equal(a.indexAt(2.1,edited,null),0);assert.equal(a.indexAt(2.1,edited,{bpm:120,meter:'4/4',firstDownbeat:0}),1);assert.equal(a.indexAt(2.1,edited,{bpm:120,meter:'4/4',firstDownbeat:.2}),0);assert.equal(a.indexAt(2.25,edited,{bpm:120,meter:'4/4',firstDownbeat:.2}),1);assert.equal(a.indexAt(2.2,edited,{bpm:60,meter:'6/8',firstDownbeat:0}),0);assert.equal(a.indexAt(2.34,edited,{bpm:60,meter:'6/8',firstDownbeat:0}),1);
assert.throws(()=>a.align(Array(1501).fill({name:'G',time:0}),hits));console.log('PASS sequence alignment, repetitions, uncertainty, corrections, enharmonic names and rhythm/bar-start timing');

const page=[{number:1,chords:[{name:'G',x:.1,y:.2,width:.03,height:.01},{name:'C',x:.5,y:.2,width:.03,height:.01}]}];assert.equal(a.positions(page)[0].name,'G');assert.equal(a.positions(page,true)[0].name,'C');
const fs=require('fs'),vm=require('vm');const scope={};vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../src/GuitarPracticeLab.Web/wwwroot/rhythm-points.js'),'utf8'),scope);const rhythm={bpm:120,meter:'4/4',firstDownbeat:0,points:[{time:2,bpm:60,meter:'6/8'}]};assert.equal(a.indexAt(2.2,edited,scope.SongRhythmPoints.at(rhythm,2.2)),0);assert.equal(a.indexAt(2.34,edited,scope.SongRhythmPoints.at(rhythm,2.34)),1);

const hebrewPage=[{number:1,rightToLeft:true,chords:[{name:'F',x:.55,y:.502,height:.02,width:.03},{name:'Em',x:.7,y:.498,height:.02,width:.04},{name:'Am',x:.85,y:.501,height:.02,width:.04},{name:'G',x:.8,y:.55,height:.02,width:.03}]}];
assert.deepEqual(a.positions(hebrewPage).map(h=>h.name),['Am','Em','F','G']);
assert.deepEqual(a.positions(hebrewPage,'ltr').map(h=>h.name),['F','Em','Am','G']);
assert.equal(a.positions(hebrewPage,'rtl').find(h=>h.name==='Em').key,'1:1');
const rtlHits=a.positions(hebrewPage);const rtlAlignment=a.align([{name:'Am',time:0},{name:'Em',time:4},{name:'F',time:8},{name:'G',time:12}],rtlHits);assert.deepEqual(rtlAlignment.map(e=>e.hit.name),['Am','Em','F','G']);

const skipChanges=[{time:0,name:'Em'},{time:1,name:'Am'},{time:4,name:'F'}],skipHits=[{name:'Em',key:'1:0'},{name:'Am',key:'1:1'},{name:'F',key:'1:2'}];
const skipResult=a.align(skipChanges,skipHits,{}, {1:true});assert.equal(skipResult[1].skipped,true);assert.equal(skipResult[1].hit,null);assert.equal(a.indexAt(2,skipChanges,null,{1:true}),0);assert.equal(a.indexAt(4,skipChanges,null,{1:true}),2);assert.equal(a.indexAt(.5,skipChanges,null,{0:true}),-1);
const repeatChanges=[{time:0,name:'C'},{time:4,name:'C'},{time:8,name:'F'}],repeatHits=[{name:'C',key:'1:0'},{name:'F',key:'1:1'}];const repeatResult=a.align(repeatChanges,repeatHits,{0:'1:0',1:'1:0',2:'1:1'});assert.equal(repeatResult[0].hit.key,repeatResult[1].hit.key);assert.ok(repeatResult.every(e=>e.confident));

// A repeated audio detection may hold the same printed chord without consuming another occurrence.
const held=a.align([{name:'Am',time:0},{name:'Am',time:4},{name:'Em',time:8}],[{name:'Am',key:'1:0'},{name:'Em',key:'1:1'}]);
assert.deepEqual(held.map(e=>e.hit.key),['1:0','1:0','1:1']);

// Regression: only the second bar was saved, leaving the first bar invisible.
const heldTimeline=[{source:0,name:'Am',time:0},{source:0,name:'Am',time:4,repeat:true},{source:1,name:'Em',time:8}];
for(const spots of [[{key:'a',name:'Am'},{key:'b',name:'Am'},{key:'e',name:'Em'}],[{key:'a',name:'Am'},{key:'e',name:'Em'}]]){
 const chosen=spots.length===3?spots[1]:spots[0];
 const input=[{hit:spots[0],confident:false},{hit:chosen,confident:true},{hit:spots.at(-1),confident:false}];
 const fixed=a.resolveHeldBars(input,heldTimeline,spots,{1:chosen.key});
 assert.equal(fixed[0].hit.key,'a');assert.equal(fixed[0].confident,true);
 assert.equal(fixed[1].hit.key,chosen.key);assert.equal(fixed[2].confident,false);
 assert.equal(input[0].confident,false);
 const explicit=a.resolveHeldBars(input,heldTimeline,spots,{0:'a',1:chosen.key});assert.equal(explicit[0].confident,false);
}

// Editing the next bar of a long detected chord must not rewrite earlier bars.
const longAnalysis={shift:0,changes:[{time:0,name:'G'},{time:12,name:'Em'},{time:20,name:'C'}]};
const longSections=[{id:'0',source:0,time:0,name:'G'},{id:'0@4.000',source:0,time:4,name:'G',repeat:true},{id:'0@8.000',source:0,time:8,name:'G',repeat:true},{id:'1',source:1,time:12,name:'Em'},{id:'1@16.000',source:1,time:16,name:'Em',repeat:true},{id:'2',source:2,time:20,name:'C'}];
const marks={anchors:{0:'g','0@4.000':'g',1:'em','1@16.000':'em2',2:'c'},skips:{2:true},repeats:[{source:0,time:4},{source:0,time:8},{source:1,time:16}],mode:'auto',direction:'rtl'};
const split=a.editSection(longAnalysis,longSections,1,marks,'D','d');
assert.deepEqual(split.analysis.changes,[{time:0,name:'G'},{time:4,name:'D'},{time:12,name:'Em'},{time:20,name:'C'}]);
assert.equal(split.selectedId,'1');assert.deepEqual(split.state.anchors,{0:'g',1:'d',2:'em','2@16.000':'em2',3:'c'});assert.deepEqual(split.state.skips,{3:true});assert.deepEqual(split.state.repeats,[{source:1,time:8},{source:2,time:16}]);assert.equal(split.state.mode,'auto');assert.equal(split.state.direction,'rtl');assert.equal(longAnalysis.changes[0].name,'G');assert.equal(marks.anchors['0@4.000'],'g');
console.log('PASS repeated-bar correction splits timeline, keeps earlier G, remaps later marks/skips/repeats and leaves original data untouched');

const migrated=a.migrateTimelineState(longAnalysis,{changes:[{time:0,name:'G'},{time:4,name:'D'},{time:12,name:'Em'},{time:20,name:'C'}]},marks);
assert.deepEqual(migrated.anchors,{0:'g',2:'em','2@16.000':'em2',3:'c'});assert.deepEqual(migrated.skips,{3:true});assert.deepEqual(migrated.repeats,[{source:2,time:16}]);assert.equal(migrated.mode,'auto');assert.equal(migrated.direction,'rtl');
const sameNameSplit=a.migrateTimelineState(longAnalysis,{changes:[{time:0,name:'G'},{time:4,name:'G'},{time:12,name:'Em'},{time:20,name:'C'}]},marks);assert.equal(sameNameSplit.anchors[1],'g');assert.deepEqual(sameNameSplit.repeats,[{source:1,time:8},{source:2,time:16}]);
const deleted=a.migrateTimelineState(longAnalysis,{changes:[{time:0,name:'G'},{time:20,name:'C'}]},marks);assert.equal(deleted.anchors[1],'c');assert.equal(deleted.anchors['1@16.000'],undefined);assert.deepEqual(deleted.skips,{1:true});assert.equal(marks.anchors[1],'em');
console.log('PASS split/delete migration retains unrelated PDF anchors, skips, repeats, Auto mode and reading order');
