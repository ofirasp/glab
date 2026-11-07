/* Standard-tuning patterns. String index 0 is low E; MIDI preserves octaves. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GuitarScales=api;})(globalThis,()=>{
'use strict';
const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const tuning=[40,45,50,55,59,64],roots=[8,9,10,11,12,1,2,3,4,5,6,7];
const patterns={minorPentatonic:{name:'Minor pentatonic',intervals:[0,3,5,7,10],frets:[[0,3],[0,2],[0,2],[0,2],[0,3],[0,3]]},major:{name:'Major',intervals:[0,2,4,5,7,9,11],frets:[[0,2],[-1,0,2],[-1,1,2],[-1,1,2],[0,2],[-1,0,2]]}};
function spelling(root,type,interval){
 const letters=['C','D','E','F','G','A','B'],natural=[0,2,4,5,7,9,11],degree=patterns[type].intervals.indexOf(interval),steps=type==='major'?[0,1,2,3,4,5,6]:[0,2,3,4,6],letter=(letters.indexOf(names[root][0])+steps[degree])%7;
 let accidental=((root+interval)%12-natural[letter]+12)%12;if(accidental>6)accidental-=12;
 return {name:letters[letter]+(accidental<0?'♭'.repeat(-accidental):'♯'.repeat(accidental)),accidental};
}
function build(root,type,position){
 root=Number(root);if(!Number.isInteger(root)||root<0||root>11||!patterns[type])throw Error('Choose a valid key and scale.');
 const open=position==='open'&&root===0&&type==='major';
 const shape=patterns[type],start=open?0:roots[root],notes=[];
 const fretsByString=open?[[0,1,3],[0,2,3],[0,2,3],[0,2],[0,1,3],[0,1,3]]:shape.frets;
 fretsByString.forEach((frets,string)=>frets.forEach(offset=>{const fret=start+offset,midi=tuning[string]+fret,pc=midi%12,interval=(pc-root+12)%12,spelled=spelling(root,type,interval);notes.push({string,fret,midi,pc,name:spelled.name,octave:Math.floor((midi-spelled.accidental)/12)-1,root:pc===root});}));
 const lastRoot=notes.map(n=>n.root).lastIndexOf(true),ascending=open?notes.slice(notes.findIndex(note=>note.root)):notes.slice(0,lastRoot+1);
 return {root,type,open,name:names[root]+' '+shape.name.toLowerCase(),notes,ascending,minFret:Math.min(...notes.map(n=>n.fret)),maxFret:Math.max(...notes.map(n=>n.fret)),bassMidi:36+root};
}
function sequence(scale,direction){
 const up=scale.ascending;
 if(scale.open){
  const down=[...scale.notes].reverse();
  if(direction==='down')return down;
  // Start on C, descend past it to low E, then return to C on the next loop.
  if(direction==='both')return [...up,...down.slice(1),...scale.notes.slice(1,scale.notes.length-up.length)];
 }
 if(direction==='down')return [...up].reverse();
 if(direction==='both')return [...up,...up.slice(1,-1).reverse()];
 return [...up];
}
function backingProgression(scale){
 const minor=scale.type==='minorPentatonic';
 const degrees=minor?[[0,'m',[0,3,7]],[3,'',[0,4,7]],[10,'sus2',[0,2,7]],[0,'m',[0,3,7]]]
                    :[[0,'',[0,4,7]],[5,'',[0,4,7]],[7,'',[0,4,7]],[0,'',[0,4,7]]];
 return degrees.map(([interval,suffix,triad])=>{
  const root=(scale.root+interval)%12;
  const name=spelling(scale.root,scale.type,interval).name+suffix;
  return {name,bass:36+root,notes:triad.map(offset=>48+root+offset)};
 });
}
return {names,patterns,build,sequence,backingProgression};
});
