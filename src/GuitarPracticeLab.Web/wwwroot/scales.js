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
function build(root,type){
 root=Number(root);if(!Number.isInteger(root)||root<0||root>11||!patterns[type])throw Error('Choose a valid key and scale.');
 const shape=patterns[type],start=roots[root],notes=[];
 shape.frets.forEach((frets,string)=>frets.forEach(offset=>{const fret=start+offset,midi=tuning[string]+fret,pc=midi%12,interval=(pc-root+12)%12,spelled=spelling(root,type,interval);notes.push({string,fret,midi,pc,name:spelled.name,octave:Math.floor((midi-spelled.accidental)/12)-1,root:pc===root});}));
 const lastRoot=notes.map(n=>n.root).lastIndexOf(true),ascending=notes.slice(0,lastRoot+1);
 return {root,type,name:names[root]+' '+shape.name.toLowerCase(),notes,ascending,minFret:Math.min(...notes.map(n=>n.fret)),maxFret:Math.max(...notes.map(n=>n.fret)),bassMidi:36+root};
}
function sequence(scale,direction){const up=scale.ascending;if(direction==='down')return [...up].reverse();if(direction==='both')return [...up,...up.slice(1,-1).reverse()];return [...up];}
return {names,patterns,build,sequence};
});
