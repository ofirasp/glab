(function(){
'use strict';
const el=id=>document.getElementById(id),S=GuitarScales,F=FretboardNotes;
let first=0,notes=[],intervalLabels=false,quiz=false,target=null,selected=null,correct=0,attempts=0,pending=null,revealed=null,context,master,muted=false;
const voices=new Set();
for(let i=0;i<12;i++)for(const id of ['highlight','mapKey']){const o=document.createElement('option');o.value=i;o.textContent=S.names[i];el(id).append(o);}
function message(value){el('mapMessage').textContent=value;}
function volume(){if(master)master.gain.value=muted?0:Number(el('mapVolume').value)/100;el('mapMute').textContent=muted?'Unmute':'Mute';el('mapMute').setAttribute('aria-pressed',String(muted));}
function stopAudio(){for(const voice of voices){try{voice.stop();}catch{}}voices.clear();}
async function sound(note){
 if(!note)return;
 try{context??=new AudioContext();if(!master){master=context.createGain();master.connect(context.destination);volume();}await context.resume();if(document.hidden)return;stopAudio();
  const o=context.createOscillator(),g=context.createGain(),t=context.currentTime;o.frequency.value=440*2**((note.midi-69)/12);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.22,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.65);o.connect(g).connect(master);voices.add(o);o.onended=()=>{voices.delete(o);o.disconnect();g.disconnect();};o.start(t);o.stop(t+.7);
 }catch(e){message('Could not play the reference note: '+e.message);}
}
function cancelNext(){clearTimeout(pending);pending=null;revealed=null;}
function targetName(){return notes.find(n=>n.pc===target&&n.inScale)?.name||S.names[target];}
function nextQuestion(){cancelNext();selected=null;target=F.choose(notes,target);message('Tap any '+targetName()+' in this fret range. Any octave counts.');draw();}
function rebuild(){cancelNext();stopAudio();selected=null;const type=el('mapScale').value;if(type)el('accidentals').checked=true;el('accidentals').disabled=!!type;notes=F.windowNotes(first,Number(el('mapKey').value),type,el('accidentals').checked);if(quiz)nextQuestion();else draw();}
function choose(note){
 if(pending)return;sound(note);selected=note;
 if(!quiz){message(note.name+' · string '+(6-note.string)+' · '+(note.fret?'fret '+note.fret:'open string')+' · '+note.interval+' from '+S.names[Number(el('mapKey').value)]);draw();return;}
 attempts++;revealed=note;
 if(note.pc===target){correct++;message('Correct! '+note.name+' · string '+(6-note.string)+' · '+(note.fret?'fret '+note.fret:'open')+'.');draw();pending=setTimeout(nextQuestion,800);}
 else{message('That is '+note.name+'. Find '+targetName()+' — try another position.');draw();}
}
function draw(){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 740 210');svg.setAttribute('role','group');svg.setAttribute('aria-label','Guitar fretboard, frets '+first+' to '+(first+4)+', high E at top');
 const add=(tag,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text!==undefined)n.textContent=text;parent.append(n);return n;};
 const width=130,x=f=>65+(f-first+.5)*width,y=s=>188-s*32;
 for(let f=first;f<=first+5;f++)add('line',{x1:65+(f-first)*width,x2:65+(f-first)*width,y1:28,y2:188,stroke:'#52667f','stroke-width':first===0&&f===1?5:2});
 for(let f=first;f<first+5;f++)add('text',{x:x(f),y:16,fill:'#c3d2e5','text-anchor':'middle','font-size':14},f===0?'Open':f);
 const strings=['E₂','A₂','D₃','G₃','B₃','E₄'];for(let s=0;s<6;s++){add('text',{x:12,y:y(s)+5,fill:'#afbed2','font-size':14},strings[s]);add('line',{x1:65,x2:715,y1:y(s),y2:y(s),stroke:'#8a9bb0','stroke-width':s<3?2:1});}
 notes.filter(n=>n.visible).forEach(note=>{
  const picked=selected?.string===note.string&&selected?.fret===note.fret,highlight=el('highlight').value!==''&&note.pc===Number(el('highlight').value),dim=!note.inScale||(!quiz&&el('highlight').value!==''&&!highlight),reveal=quiz&&revealed?.string===note.string&&revealed?.fret===note.fret;
  const accessible=quiz&&!reveal?'String '+(6-note.string)+', '+(note.fret?'fret '+note.fret:'open string'):note.name+', string '+(6-note.string)+', fret '+note.fret;
  const g=add('g',{role:'button',tabindex:!quiz||note.inScale?'0':'-1','data-pc':note.pc,'data-string':note.string,'data-fret':note.fret,'aria-label':accessible,'aria-disabled':quiz&&!note.inScale,opacity:dim?.25:1});
  add('rect',{x:x(note.fret)-64,y:y(note.string)-16,width:128,height:32,fill:'transparent'},undefined,g);
  const fill=quiz?(reveal?(note.pc===target?'#6cd3a1':'#df8c9e'):'#64b5ee'):picked||highlight?'#ffd677':note.root?'#df8c9e':'#64b5ee';
  add('circle',{class:'dot',cx:x(note.fret),cy:y(note.string),r:14,fill,stroke:picked?'#fff1c2':'#192639','stroke-width':picked?2:1},undefined,g);
  add('text',{x:x(note.fret),y:y(note.string)+5,fill:'#102035','font-size':13,'font-weight':700,'text-anchor':'middle'},quiz&&!reveal?'?':intervalLabels&&!quiz?note.interval:note.name,g);
  if(!quiz||note.inScale){g.onclick=()=>choose(note);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(note);}};}
 });
 el('mapBoard').replaceChildren(svg);el('range').textContent=(first===0?'Open':first)+'–'+(first+4);el('lower').disabled=first===0;el('higher').disabled=first===20;el('highlight').disabled=quiz;el('labels').disabled=quiz;
 el('score').textContent=quiz?correct+' correct / '+attempts+' taps':'';el('mapTarget').textContent=quiz?'Find '+targetName():selected?.name||'Tap a note';el('mapDetail').textContent=quiz?'Any matching position':selected?'String '+(6-selected.string)+' · '+(selected.fret?'fret '+selected.fret:'open string'):'Standard tuning · no capo';el('hearMap').textContent=quiz?'Hear target':'Hear note';el('hearMap').disabled=!quiz&&!selected;
 el('mapLegend').textContent=quiz?'Names hidden · tap the requested note · no microphone needed':'High E at top · low E at bottom · red = root · yellow = selected';
}
el('lower').onclick=()=>{first=Math.max(0,first-5);rebuild();};el('higher').onclick=()=>{first=Math.min(20,first+5);rebuild();};
for(const id of ['mapKey','mapScale','accidentals'])el(id).onchange=()=>{if(id==='accidentals'&&!el('accidentals').checked&&el('highlight').value!==''&&![0,2,4,5,7,9,11].includes(Number(el('highlight').value)))el('highlight').value='';rebuild();if(!quiz)message('Tap a note to hear it. Dim notes are outside the selected scale.');};
el('highlight').onchange=()=>{if(el('highlight').value!==''&&![0,2,4,5,7,9,11].includes(Number(el('highlight').value)))el('accidentals').checked=true;rebuild();};
el('labels').onclick=()=>{intervalLabels=!intervalLabels;el('labels').textContent=intervalLabels?'Show notes':'Show intervals';el('labels').setAttribute('aria-pressed',String(intervalLabels));draw();};
function mode(value){cancelNext();stopAudio();quiz=value;correct=0;attempts=0;selected=null;target=null;el('quiz').classList.toggle('active',quiz);el('explore').classList.toggle('active',!quiz);el('skip').hidden=!quiz;rebuild();if(!quiz)message('Tap any note to hear it. Use the arrows to explore frets 0–24.');}
el('quiz').onclick=()=>mode(true);el('explore').onclick=()=>mode(false);el('skip').onclick=()=>{cancelNext();nextQuestion();};
el('hearMap').onclick=()=>sound(quiz?notes.find(n=>n.pc===target&&n.inScale):selected);
el('mapVolume').oninput=()=>{muted=false;volume();};el('mapMute').onclick=()=>{muted=!muted;volume();};el('mapHelp').onclick=()=>el('mapHelpDialog').showModal();el('mapCloseHelp').onclick=()=>el('mapHelpDialog').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopAudio();if(pending){cancelNext();if(quiz)nextQuestion();}}});window.addEventListener('pagehide',()=>{cancelNext();stopAudio();});
const openQuiz = new URLSearchParams(location.search).get('mode') === 'quiz';
if (openQuiz) el('mapBack').href = '/practice.html?tab=practice';
mode(openQuiz);
})();
