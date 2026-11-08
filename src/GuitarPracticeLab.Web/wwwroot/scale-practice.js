(function(){
'use strict';
const el=id=>document.getElementById(id),S=GuitarScales,media=el('track');
let mode=new URLSearchParams(location.search).get('mode')==='along'?'along':'follow';
let scale,progression,index=0,sequence=[],running=false,preparing=false,generation=0,context,master,source,clock,nextBeat,step,startIndex=0,barBeat=0,fileUrl='',fileName='',muted=false,shownIndex=-1;
const voices=new Set(),flashes=new Set(),tracks=new Map();
for(let i=0;i<12;i++){const o=document.createElement('option');o.value=i;o.textContent=S.names[i];el('scaleKey').append(o);}el('scaleKey').value='9';
function message(text){el('message').textContent=text;}
function frequency(midi){return 440*2**((midi-69)/12);}
async function audio(){context??=new AudioContext();if(!master){master=context.createGain();master.connect(context.destination);source=context.createMediaElementSource(media);source.connect(master);volume();}await context.resume();}
function volume(){if(master)master.gain.value=muted?0:Number(el('volume').value)/100;el('mute').textContent=muted?'Unmute':'Mute';el('mute').setAttribute('aria-pressed',String(muted));}
function tone(midi,time,duration=.24,level=.18,type='sine'){
 const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type=type;oscillator.frequency.value=frequency(midi);gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(level,time+.008);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);oscillator.connect(gain).connect(master);voices.add(oscillator);oscillator.onended=()=>{voices.delete(oscillator);oscillator.disconnect();gain.disconnect();};oscillator.start(time);oscillator.stop(time+duration+.02);
}
function click(time,accent){tone(accent?92:85,time,.04,.09,'triangle');}
function later(time,action){const id=setTimeout(()=>{flashes.delete(id);if(running)action();},Math.max(0,(time-context.currentTime)*1000));flashes.add(id);}
function draw(){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 740 164');svg.setAttribute('role','group');svg.setAttribute('aria-label',scale.name+' fretboard; high E at top, low E at bottom');
 const add=(name,attrs,text,parent=svg)=>{const n=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;parent.append(n);return n;};
 const min=scale.minFret,max=scale.maxFret,width=650/(max-min+1),x=fret=>65+(fret-min+.5)*width;
 for(let f=min;f<=max+1;f++)add('line',{x1:65+(f-min)*width,x2:65+(f-min)*width,y1:24,y2:149,stroke:'#52667f','stroke-width':scale.open&&f===1?5:2});
 const strings=['E₂','A₂','D₃','G₃','B₃','E₄'];
 for(let s=0;s<6;s++){const y=149-s*25;add('text',{x:12,y:y+4,fill:'#afbed2','font-size':13},strings[s]);add('line',{x1:65,x2:715,y1:y,y2:y,stroke:'#8a9bb0','stroke-width':s<3?2:1});}
 for(let f=min;f<=max;f++)add('text',{x:x(f),y:15,fill:'#afbed2','text-anchor':'middle','font-size':12},f===0?'Open':'Fret '+f);
 const current=sequence[index];
 scale.notes.forEach((n,i)=>{
  const active=mode==='follow'&&current.string===n.string&&current.fret===n.fret,g=add('g',{'data-note':i,tabindex:'0',role:'button','aria-label':n.name+n.octave+', string '+(6-n.string)+', fret '+n.fret+(active?', play now':'')});
  add('circle',{cx:x(n.fret),cy:149-n.string*25,r:active?12:10,fill:active?'#ffd677':n.root?'#df8c9e':'#64b5ee',stroke:active?'#fff1c2':'#192639','stroke-width':active?2:1},undefined,g);
  add('text',{x:x(n.fret),y:153-n.string*25,fill:'#102035','text-anchor':'middle','font-size':11,'font-weight':700},n.name, g);
  const hear=async()=>{try{await audio();tone(n.midi,context.currentTime+.01);}catch(e){message('Audio unavailable: '+e.message);}};
  g.onclick=hear;g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();hear();}};
 });
 el('fretboard').replaceChildren(svg);el('target').textContent=mode==='follow'?current.name: S.names[scale.root];el('detail').textContent=mode==='follow'?'String '+(6-current.string)+(current.fret?' · fret '+current.fret:' · open'):scale.name;el('progress').textContent=mode==='follow'?(index+1)+' / '+sequence.length:'Root notes in red';shownIndex=index;
}
function lock(){
 window.GuitarScreenAwake?.setGeneratedPlayback(running&&mode==='along'&&el('backing').value==='groove');
 for(const id of ['scaleKey','scaleType','scalePosition','direction','backing','chooseAudio'])el(id).disabled=running||preparing;
 for(const id of ['previous','next'])el(id).disabled=running||preparing;
 el('play').disabled=preparing||(mode==='along'&&el('backing').value==='file'&&!fileUrl);el('play').textContent=preparing?'Starting…':running?'Pause':'Start';
 const external=mode==='along'&&el('backing').value!=='groove';for(const id of ['bpm','slower','faster'])el(id).disabled=external;
}
function stop(text){generation++;preparing=false;running=false;clearInterval(clock);flashes.forEach(clearTimeout);flashes.clear();for(const v of voices){try{v.stop();}catch{}}voices.clear();media.pause();lock();if(text)message(text);}
function updateScale(){
 stop();
 const key=el('scaleKey').value,type=el('scaleType').value;
 const canUseOpen=key==='0'&&type==='major';
 el('positionLabel').hidden=!canUseOpen;
 scale=S.build(key,type,canUseOpen?el('scalePosition').value:undefined);
 progression=S.backingProgression(scale);
 updateGrooveInfo();
 sequence=S.sequence(scale,el('direction').value);
 index=0;
 draw();
}
function setMode(value){stop();mode=value;el('scaleBack').href='/practice.html?tab='+(mode==='follow'?'tools':'practice');el('followMode').classList.toggle('active',mode==='follow');el('alongMode').classList.toggle('active',mode==='along');el('followOptions').hidden=mode!=='follow';el('alongOptions').hidden=mode!=='along';el('directionLabel').hidden=mode!=='follow';el('trackLabel').hidden=mode!=='along';draw();lock();message(mode==='follow'?'Four count-in beats, then one note per beat. No microphone scoring.':'Use short phrases and pauses. Choose the matching key for imported tracks.');}
function schedule(){
 while(running&&nextBeat<context.currentTime+.1){
  const t=nextBeat,beatLength=60/Number(el('bpm').value);
  if(mode==='follow'){
   if(step<0){const count=step+5;click(t,true);later(t,()=>{message('Count in: '+count+' / 4');el('progress').textContent='Ready · '+count;});step++;}
   else{const i=(step+startIndex)%sequence.length,note=sequence[i];click(t,i===0);if(el('hearNotes').checked)tone(note.midi,t,Math.min(.4,beatLength*.7));later(t,()=>{index=i;if(shownIndex!==index)draw();else el('progress').textContent=(i+1)+' / '+sequence.length;message('Play one note per beat · '+scale.name+' · No microphone scoring.');});step++;}
  }else{
   const beat=barBeat%4;
   const chord=progression[Math.floor(barBeat/4)%progression.length];
   tone(chord.bass+(beat===2?7:0),t,beatLength*.65,.23,'triangle');
   if(beat===0||beat===2){
    chord.notes.forEach((note,i)=>tone(note,t+i*.016,beatLength*1.6,.075,'triangle'));
   }
   tone(beat%2===0?36:78,t,.09,beat%2===0?.24:.085);
   later(t,()=>{el('progress').textContent=chord.name+' · Beat '+(beat+1);});
   barBeat++;
  }
  nextBeat+=beatLength;
 }
}
async function start(){
 if(running||preparing){stop('Paused. Tap Start when ready.');return;}
 preparing=true;const token=++generation;lock();
 try{
  await audio();if(token!==generation)return;
  if(mode==='along'&&el('backing').value!=='groove'){
   const chosen=el('backing').value,url=chosen==='file'?fileUrl:tracks.get(chosen)?.url;
   if(!url)throw Error('Choose an audio file first.');if(media.getAttribute('src')!==url)media.src=url;media.loop=el('loopTrack').checked;
   await media.play();if(token!==generation){media.pause();return;}running=true;message('Playing backing audio. Match the scale key to your song; tempo is set by the recording.');
  }else{
   running=true;step=-4;barBeat=0;nextBeat=context.currentTime+.12;
   startIndex=index;
   schedule();clock=setInterval(schedule,25);message(mode==='follow'?'Get ready…':'Playing the '+scale.name+' chord loop.');
  }
 }catch(e){if(token===generation)stop('Could not play audio: '+e.message);}
 finally{if(token===generation){preparing=false;lock();}}
}
el('play').onclick=start;el('reset').onclick=()=>{stop();index=0;media.currentTime=0;draw();message('Reset. Ready to start.');};
for(const id of ['scaleKey','scaleType','scalePosition','direction'])el(id).onchange=()=>{updateScale();message('Ready · '+scale.name);};
el('followMode').onclick=()=>setMode('follow');el('alongMode').onclick=()=>setMode('along');
el('next').onclick=()=>{index=(index+1)%sequence.length;draw();};el('previous').onclick=()=>{index=(index+sequence.length-1)%sequence.length;draw();};
el('hear').onclick=async()=>{try{await audio();tone(sequence[index].midi,context.currentTime+.01);}catch(e){message('Audio unavailable: '+e.message);}};
function tempo(value){el('bpm').value=Math.max(40,Math.min(160,value));el('bpmValue').textContent=el('bpm').value;}
el('bpm').oninput=()=>tempo(Number(el('bpm').value));el('slower').onclick=()=>tempo(Number(el('bpm').value)-5);el('faster').onclick=()=>tempo(Number(el('bpm').value)+5);
el('volume').oninput=()=>{muted=false;volume();};el('mute').onclick=()=>{muted=!muted;volume();};
el('help').onclick=()=>el('scaleHelp').showModal();el('closeHelp').onclick=()=>el('scaleHelp').close();
function grooveDescription(){return progression.map(chord=>chord.name).join(' → ')+' · loops in '+scale.name;}
function updateGrooveInfo(){
 if(el('backing').value==='groove')el('trackInfo').textContent=grooveDescription();
}
function trackChanged(){stop();media.removeAttribute('src');media.load();const value=el('backing').value;el('chooseAudio').hidden=value!=='file';el('trackInfo').textContent=value==='groove'?grooveDescription():value==='file'?(fileName||'Choose an audio file from this device. It stays on this device.'):'Choose the matching key and scale for this backing track.';lock();if(value==='file'&&!fileUrl)el('audioFile').click();}
el('backing').onchange=trackChanged;el('chooseAudio').onclick=()=>el('audioFile').click();el('loopTrack').onchange=()=>{media.loop=el('loopTrack').checked;};
el('audioFile').onchange=()=>{const file=el('audioFile').files[0];if(!file)return;stop();if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=URL.createObjectURL(file);fileName=file.name;media.removeAttribute('src');media.load();el('backing').value='file';el('chooseAudio').hidden=false;el('trackInfo').textContent=fileName+' · choose its matching scale key';lock();};
media.onended=()=>stop('Track finished. Tap Start to play again.');media.onerror=()=>{if(running||preparing)stop('Audio could not be loaded. Check the selected backing file.');};
async function loadTracks(){
 try{
  const response=await fetch('/api/scale-backing',{signal:AbortSignal.timeout(8000)});
  if(!response.ok)return;
  for(const track of await response.json()){
   const key='scale:'+track.name;
   tracks.set(key,{url:'/api/scale-backing/audio?'+new URLSearchParams({name:track.name})});
   const option=document.createElement('option');
   option.value=key;
   option.textContent=track.title;
   el('backing').append(option);
  }
 }catch{/* Built-in and local-file playback are still available. */}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Paused while away. Tap Start to continue.');});window.addEventListener('pagehide',()=>{stop();if(fileUrl)URL.revokeObjectURL(fileUrl);});
updateScale();setMode(mode);loadTracks();
})();
