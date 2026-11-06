(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./scales.js'));else root.FretboardNotes=factory(root.GuitarScales);})(globalThis,S=>{
'use strict';
const tuning=[40,45,50,55,59,64],natural=new Set([0,2,4,5,7,9,11]),intervals=['R','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
function windowNotes(first,root=0,type='',accidentals=false){
 if(!Number.isInteger(first)||first<0||first>20||!Number.isInteger(root)||root<0||root>11||type&&!S.patterns[type])throw Error('Invalid fretboard settings.');
 const scale=type?S.build(root,type):null,spellings=new Map(scale?.notes.map(n=>[n.pc,n.name])||[]),notes=[];
 for(let string=0;string<6;string++)for(let fret=first;fret<first+5;fret++){
  const midi=tuning[string]+fret,pc=midi%12,distance=(pc-root+12)%12,inScale=!type||S.patterns[type].intervals.includes(distance);
  notes.push({string,fret,midi,pc,name:spellings.get(pc)||S.names[pc],interval:intervals[distance],root:pc===root,inScale,visible:!!type||accidentals||natural.has(pc)});
 }
 return notes;
}
function candidates(notes){return notes.filter(n=>n.visible&&n.inScale);}
function choose(notes,previous=null,random=Math.random){const all=[...new Set(candidates(notes).map(n=>n.pc))],pool=all.filter(pc=>pc!==previous);const values=pool.length?pool:all;return values.length?values[Math.min(values.length-1,Math.floor(Math.max(0,random())*values.length))]:null;}
return {windowNotes,candidates,choose};
});
