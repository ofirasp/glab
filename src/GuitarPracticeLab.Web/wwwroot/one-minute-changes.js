(function(){
'use strict';
const el=id=>document.getElementById(id),api='/api/chord-practice';
let session=null,polling=false,preparing=false,available=false,receivedAt=0,shownTarget='',leaving=false,priorStatus='';
const active=()=>preparing||session&&['preparing','running'].includes(session.status);
async function request(path,options={}){const r=await fetch(api+path,{...options,signal:AbortSignal.timeout(15000)});const value=await r.json().catch(()=>({}));if(!r.ok)throw Error(value.message||value.detail||'Exercise request failed.');return value;}
const qualities=['','m','7','maj7','m7','sus2','sus4','5','6','m6','add9','madd9','6add9','dim','dim7','aug','m7b5','9','m9','maj9','7sus4','7sus2','7b5','7#5','7b9','7#9'];
for(const root of ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'])for(const quality of qualities){const name=root+quality;for(const id of ['changesFirst','changesSecond']){const o=document.createElement('option');o.value=o.textContent=name;el(id).append(o);}}
el('changesFirst').value='C';el('changesSecond').value='G';
function message(text){el('changesMessage').textContent=text;}
function target(name){if(shownTarget===name)return;shownTarget=name;el('changesTarget').textContent='Play '+name;el('changesDiagram').replaceChildren();const shape=GuitarChords.shapes(name)[0];if(shape)el('changesDiagram').append(GuitarChordDiagram(shape,name));}
function draw(){
 const busy=active(),locked=busy||(session?.status==='completed'&&!session.saved);for(const id of ['changesFirst','changesSecond','changesDevice','changesSensitivity','changesTuning'])el(id).disabled=!!locked;
 el('changesBack').disabled=preparing;el('changesCancel').disabled=!session||session.status!=='running';
 el('changesStart').disabled=!!busy||!available||!el('changesTuning').checked||(session?.status==='completed'&&!session.saved);
 el('changesRetry').hidden=!(session?.status==='completed'&&!session.saved);
 el('changesStart').textContent=preparing?'Connecting…':session?.status==='completed'?'Try again':'Start';
 target(session?.status==='running'?session.target:el('changesFirst').value);
 const other=session?.status==='running'?(session.target===session.first?session.second:session.first):el('changesSecond').value;
 el('changesNext').textContent='Then '+other;const count=session?.correctChords||0;el('changesCount').textContent=count+(count===1?' chord':' chords');
 el('changesLevel').value=Math.min(.1,session?.rms||0);
}
function countdown(){let remaining=session?.status==='running'?Math.max(0,session.remaining-(performance.now()-receivedAt)/1000):session?.status==='completed'?0:60;
 const seconds=Math.ceil(remaining);el('changesTime').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
function receive(value){session=value;if(value?.first&&value?.second){el('changesFirst').value=value.first;el('changesSecond').value=value.second;}receivedAt=performance.now();draw();countdown();
 if(!session)return;
 if(session.status==='running')message(session.detected===session.target?'Hold the chord clearly…':'Play the shown chord, let it ring, then change when the target moves.');
 if(session.status==='completed')message(`${session.correctChords} correct chords · ${session.changes} changes in 1 minute. ${session.saved?'Saved on the Pi.':session.error}`);
 if(session.status==='cancelled')message('Round cancelled. Partial rounds are not saved.');
 if(session.status==='error')message(session.error||'Microphone unavailable.');
}
async function poll(){if(polling||!active()||preparing)return;polling=true;try{const value=await request('/active');if(value)receive(value);else{session=null;draw();message('The server restarted. This unfinished round has no saved result.');}}catch{message('Connection interrupted. The Pi keeps the timer and saves completed results. Reconnecting…');}finally{polling=false;}}
async function devices(){try{const value=await request('/devices');available=value.available;el('changesDevice').replaceChildren();for(const name of value.devices){const o=document.createElement('option');o.value=o.textContent=name;el('changesDevice').append(o);}if(!available)message(value.message);draw();}catch(e){available=false;message(e.message);draw();}}
async function openExercise(){priorStatus=el('status').textContent;el('status').textContent='Live Pi microphone · standard tuning · no capo · use headphones to avoid speaker bleed';stopTone();stopMetro();document.dispatchEvent(new Event('guitar-exercise-open'));el('practice').hidden=true;el('tuner').hidden=true;el('metro').hidden=true;el('chordChanges').hidden=false;leaving=false;draw();await devices();try{const value=await request('/active');if(value)receive(value);}catch(e){message(e.message);}}
el('oneMinuteChanges').onclick=openExercise;
for(const id of ['changesFirst','changesSecond','changesTuning'])el(id).onchange=()=>{shownTarget='';session=null;draw();countdown();};
el('changesStart').onclick=async()=>{
 const first=el('changesFirst').value,second=el('changesSecond').value;
 if(!el('changesTuning').checked){message('Confirm standard tuning with no capo first.');return;}
 const a=GuitarChords.parse(first),b=GuitarChords.parse(second);
 if([...a.notes].sort().join(',')===[...b.notes].sort().join(',')){message('Choose two chords with different notes; equivalent chord names sound the same to the detector.');return;}
 stopTone();stopMetro();preparing=true;session=null;draw();message('Connecting to the Pi microphone. The minute starts when audio is ready.');
 try{const value=await request('/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({first,second,device:el('changesDevice').value,sensitivity:Number(el('changesSensitivity').value)})});if(leaving||document.hidden){await request('/'+value.id+'/cancel',{method:'POST'});session=null;message('Round cancelled. Start again when ready.');}else receive(value);}
 catch(e){message(e.message);}finally{preparing=false;draw();}
};
el('changesCancel').onclick=async()=>{if(!session)return;try{await request('/'+session.id+'/cancel',{method:'POST'});message('Stopping microphone…');await poll();}catch(e){message(e.message);}};
el('changesRetry').onclick=async()=>{try{receive(await request('/'+session.id+'/save',{method:'POST'}));}catch(e){message(e.message);}};
async function history(){const list=el('changesResultsList');list.textContent='Loading…';el('changesResults').showModal();try{const rows=await request('/history');list.replaceChildren();if(!rows.length){list.textContent='No completed rounds yet.';return;}const best={};for(const r of rows){const key=[r.first,r.second].sort().join(' ↔ ');best[key]=Math.max(best[key]||0,r.correctChords);}for(const r of rows){const row=document.createElement('div');row.className='changeresult';const title=document.createElement('strong');title.textContent=r.first+' ↔ '+r.second+' · '+r.correctChords+' chords';const detail=document.createElement('small');detail.textContent=`${r.changes} changes · ${new Date(r.finished).toLocaleString()} · Best in recent results: ${best[[r.first,r.second].sort().join(' ↔ ')]}`;row.append(title,detail);list.append(row);}}catch(e){list.textContent=e.message;}}
el('changesHistory').onclick=history;el('changesCloseResults').onclick=()=>el('changesResults').close();
async function leave(){if(leaving)return;leaving=true;el('chordChanges').hidden=true;el('status').textContent=priorStatus;if(session?.status==='running')try{await request('/'+session.id+'/cancel',{method:'POST'});}catch{}}
el('changesBack').onclick=()=>{leave();el('practiceTab').click();};
for(const id of ['tunerTab','metroTab','practiceTab','wavUpload'])el(id).addEventListener('click',()=>{if(!el('chordChanges').hidden)leave();});
document.addEventListener('guitar-open-lesson',()=>{if(session?.status==='running')el('changesCancel').click();});
window.addEventListener('pagehide',()=>{if(session?.status==='running')navigator.sendBeacon(api+'/'+session.id+'/cancel');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.status==='running')el('changesCancel').click();});
setInterval(poll,300);setInterval(countdown,100);draw();
})();
