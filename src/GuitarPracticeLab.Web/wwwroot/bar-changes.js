(() => {
'use strict';
const el=id=>document.getElementById(id);
const qualities=[['','Major'],['m','Minor (m)'],['7','7 · Dominant'],['maj7','Major 7'],['m7','Minor 7'],['sus2','Sus2'],['sus4','Sus4'],['5','Power (5)'],['6','Major 6'],['m6','Minor 6'],['add9','Add9'],['madd9','Minor add9'],['6add9','6 add9'],['dim','Diminished'],['dim7','Diminished 7'],['aug','Augmented'],['m7b5','Minor 7♭5'],['9','Dominant 9'],['m9','Minor 9'],['maj9','Major 9'],['7sus4','7 sus4'],['7sus2','7 sus2'],['7b5','7♭5'],['7#5','7♯5'],['7b9','7♭9'],['7#9','7♯9']];
const roots=[['C','C'],['C#','C♯ / D♭'],['D','D'],['Eb','E♭ / D♯'],['E','E'],['F','F'],['F#','F♯ / G♭'],['G','G'],['Ab','A♭ / G♯'],['A','A'],['Bb','B♭ / A♯'],['B','B']];
let available=false,run=null,context=null,history=[],lastResult=null;
const storage='guitar-bar-change-results',recentKey='guitar-recent-chord-pairs';
try{const rows=JSON.parse(localStorage.getItem(storage)||'[]');if(Array.isArray(rows))history=rows.filter(r=>r&&typeof r.first==='string'&&Number.isFinite(r.accuracy)&&r.accuracy>=0&&r.accuracy<=100).slice(0,100);}catch{}
const picks={changesFirst:{name:'',index:0},changesSecond:{name:'',index:0}};
const name=id=>el(id).value+el(id+'Type').value;
const settings=()=>({first:name('changesFirst'),second:name('changesSecond'),bpm:Number(el('barTempo').value),changes:Number(el('barCount').value),meter:el('barMeter').value,metronome:el('barMetronome').value});
const key=r=>JSON.stringify([r.first,r.second,r.bpm,r.changes,r.metronome,r.meter||'4/4']);
const scores=config=>{const rows=history.filter(r=>key(r)===key(config));return {last:rows[0]?.accuracy,best:rows.length?Math.max(...rows.map(r=>r.accuracy)):undefined};};
function say(message){el('changesMessage').textContent=message;}
for(const id of ['changesFirst','changesSecond']){
 for(const [value,label] of roots)el(id).add(new Option(label,value));
 for(const [value,label] of qualities)el(id+'Type').add(new Option(label,value));
 el(id).value=id==='changesFirst'?'C':'G';
}
// Touch arrows avoid a long dropdown and do not open the on-screen keyboard.
for(const [field,min,max] of [['barTempo',20,180],['barCount',1,128]])for(const [suffix,step] of [['Up',1],['Down',-1]]){
 let delay=null,repeat=null;
 const stop=()=>{clearTimeout(delay);clearInterval(repeat);delay=repeat=null;};
 const change=()=>{if(run)return;el(field).value=Math.max(min,Math.min(max,Number(el(field).value)+step));draw();if(Number(el(field).value)===min||Number(el(field).value)===max)stop();};
 const button=el(field+suffix);
 button.onclick=change;
 button.onpointerdown=e=>{if(button.disabled)return;button.setPointerCapture(e.pointerId);delay=setTimeout(()=>{change();if(!button.disabled)repeat=setInterval(change,100);},450);};
 button.onpointerup=button.onpointercancel=button.onlostpointercapture=stop;
 button.onblur=stop;
}
let recent=[];
try{const rows=JSON.parse(localStorage.getItem(recentKey)||'[]');if(Array.isArray(rows))recent=rows.filter(r=>Array.isArray(r)&&r.length>=2&&r.slice(0,2).every(n=>typeof n==='string'&&/^[A-G](?:#|b)?/.test(n))).slice(0,8);}catch{}
function recentMenu(){el('changesRecent').replaceChildren(new Option('Choose a recent pair…',''));recent.forEach((r,i)=>el('changesRecent').add(new Option(r[0]+' → '+r[1],i)));}
function choice(id){const n=name(id),p=picks[id];if(p.name!==n){p.name=n;p.index=0;}return {...p,shapes:GuitarChords.shapes(n)};}
function setChord(id,n){const m=/^([A-G](?:#|b)?)(.*)$/.exec(n);if(m){el(id).value=m[1];el(id+'Type').value=m[2];}}
function remember(){const c=settings(),keys=['changesFirst','changesSecond'].map(id=>{const p=choice(id);return p.shapes[p.index]?.frets.join(',');});recent=[[c.first,c.second,...keys],...recent.filter(r=>r[0]!==c.first||r[1]!==c.second)].slice(0,8);try{localStorage.setItem(recentKey,JSON.stringify(recent));}catch{}recentMenu();}
function diagram(id,p){const shape=p.shapes[p.index];el(id).replaceChildren(shape?GuitarChordDiagram(shape,p.name):'No shape available');}
function draw(){
 const count=Number(el('barMeter').value.split('/')[0]);
 if(el('barBeats').children.length!==count){el('barBeats').replaceChildren(...Array.from({length:count},(_,i)=>{const s=document.createElement('span');s.textContent=i+1;if(i===0||(el('barMeter').value.endsWith('/8')&&i%3===0))s.className='accent';return s;}));}
 el('barBeats').setAttribute('aria-label',el('barMeter').value+' beats');
 const busy=Boolean(run),playing=busy&&['playing','finishing'].includes(run.phase);
 document.querySelector('.changesbody').classList.toggle('bar-exercise-active',busy);
 document.querySelector('.changessetup').inert=busy;
 document.querySelector('.changessetup').setAttribute('aria-hidden',String(busy));
 el('barActiveCancel').hidden=!busy;el('barTimingFeedback').hidden=!playing;
 const a=choice('changesFirst'),b=choice('changesSecond');
 const state=playing?run.engine.at(Math.max(0,context.currentTime-run.start)):null;
 const current=state?.target===b.name?b:a;
 el('changesPreviews').classList.toggle('running',playing);el('changesSecondPreview').hidden=false;el('changesSecondPreview').querySelector('.changesnav').hidden=playing;el('changesFirstShapes').hidden=playing;el('changesNext').hidden=true;
 el('changesTarget').textContent=(playing&&current===b?'Next: ':'Play ')+a.name;el('changesSecondTarget').textContent=playing?(current===b?'Play ':'Next: ')+b.name:b.name;
 el('changesDiagram').closest('.changesplay').classList.toggle('chord-to-play',playing&&current===a);el('changesSecondPreview').classList.toggle('chord-to-play',playing&&current===b);
 el('changesNext').textContent=state?.index===run?.engine.changes?'Last change · hold this chord':'Next bar: '+(current===a?b.name:a.name);
 diagram('changesDiagram',a);diagram('changesSecondDiagram',b);el('changesSecondDiagram').classList.toggle('matched',Boolean(state?.matched&&current===b));
 el('changesDiagram').classList.toggle('matched',Boolean(state?.matched&&current===a));
 for(const id of ['changesFirst','changesSecond']){
  const p=choice(id);el(id+'Name').textContent=p.name;el(id+'Shape').textContent=p.shapes.length?(p.index+1)+' / '+p.shapes.length:'—';
  el(id+'Prev').disabled=el(id+'Next').disabled=busy||p.shapes.length<2;
 }
 for(const id of ['changesFirst','changesFirstType','changesSecond','changesSecondType','changesDevice','barTempo','barTempoUp','barTempoDown','barCount','barCountUp','barCountDown','barMeter','barMetronome','changesRecent'])el(id).disabled=busy;
 el('barCountDown').disabled=busy||Number(el('barCount').value)<=1;el('barCountUp').disabled=busy||Number(el('barCount').value)>=128;
 el('barTempoDown').disabled=busy||Number(el('barTempo').value)<=20;el('barTempoUp').disabled=busy||Number(el('barTempo').value)>=180;
 el('changesStart').disabled=busy||!available||!el('changesDevice').value;el('changesStart').textContent=busy?'Running…':'Start';el('changesCancel').disabled=!busy;
 el('changesHistory').disabled=busy;
 const saved=scores(settings());el('changesPairScores').textContent=saved.last===undefined?settings().meter+' · '+(settings().meter.endsWith('/8')?'BPM = dotted-quarter pulse':'BPM = quarter-note pulse')+' · first chord warm-up':`Last ${saved.last}% · Best ${saved.best}% at this setup`;
 if(!busy){el('changesTime').textContent='Ready';el('changesCount').textContent='0 matches';}
}
for(const id of ['changesFirst','changesSecond'])for(const [suffix,direction]of [['Prev',-1],['Next',1]])el(id+suffix).onclick=()=>{if(run)return;const p=choice(id);picks[id].index=(p.index+direction+p.shapes.length)%p.shapes.length;remember();draw();};
for(const id of ['changesFirst','changesFirstType','changesSecond','changesSecondType','barTempo','barCount','barMeter','barMetronome'])el(id).onchange=()=>{if(!run)draw();};
el('changesRecent').onchange=()=>{if(run||el('changesRecent').value==='')return;const pair=recent[Number(el('changesRecent').value)];['changesFirst','changesSecond'].forEach((id,i)=>{setChord(id,pair[i]);const p=choice(id);picks[id].index=Math.max(0,p.shapes.findIndex(s=>s.frets.join(',')===pair[i+2]));});draw();};
function tone(r,frequency,when,duration,volume,type='sine'){
 const o=context.createOscillator(),g=context.createGain();o.type=type;o.frequency.value=frequency;
 g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(volume,when+.005);g.gain.exponentialRampToValueAtTime(.001,when+duration);
 o.connect(g).connect(context.destination);r.voices.push(o);o.onended=()=>{o.disconnect();g.disconnect();r.voices=r.voices.filter(v=>v!==o);};o.start(when);o.stop(when+duration+.02);
}
function halt(){const r=run;run=null;if(!r)return;clearInterval(r.timer);clearTimeout(r.readyTimeout);r.controller.abort();for(const v of r.voices)try{v.stop();}catch{}el('changesCountIn').close();[...el('barBeats').children].forEach(e=>e.classList.remove('current'));draw();}
function cancel(message='Round cancelled. Partial results are not saved.'){halt();say(message);}
function finish(r){
 if(run!==r)return;
 const result={...r.engine.result(),metronome:r.config.metronome,calibrationMs:Math.round(r.correction*1000),finished:new Date().toISOString()};const previous=scores(result);halt();
 let saved=true;const updated=[result,...history].slice(0,100);try{localStorage.setItem(storage,JSON.stringify(updated));history=updated;}catch{saved=false;}
 lastResult=result;draw();el('changesTime').textContent='Complete';el('changesCount').textContent=result.matches+' matches';
 const record=saved&&result.accuracy>0&&(previous.best===undefined||result.accuracy>previous.best);
 el('changesRoundResult').classList.toggle('new-best',record);el('changesRoundIcon').textContent=record?'★':'✓';el('changesRoundTitle').textContent=record?'New personal best!':'Round complete';
 el('changesRoundPair').textContent=result.first+' ↔ '+result.second+' · '+result.bpm+' BPM · '+result.meter;el('changesRoundScore').textContent=result.accuracy+'%';
 el('barResultMatches').textContent=result.matches+' / '+result.changes+' changes matched';el('barStrumScore').textContent=result.strumming.accuracy+'%';el('barStrumDetail').textContent=result.strumming.detected+' / '+result.strumming.expected+' strums · '+result.strumming.onTime+' on beat · '+result.strumming.early+' early · '+result.strumming.late+' late · '+result.strumming.missed+' missed · '+result.strumming.extra+' extra';
 const mean=result.strumming.meanOffsetMs;el('barTimingSummary').textContent='Calibration '+(result.calibrationMs>=0?'+':'')+result.calibrationMs+' ms'+(mean===null?'':' · Average '+Math.abs(mean)+' ms '+(mean<0?'early':'late'));
 el('changesRoundLast').textContent=previous.last===undefined?'—':previous.last+'%';const delta=previous.last===undefined?null:result.accuracy-previous.last;
 el('changesRoundDifference').textContent=delta===null?'First round':delta===0?'Same as last':(delta>0?'+':'')+delta+' pts';el('changesRoundDifference').classList.toggle('improved',delta>0);
 el('changesRoundBest').textContent=saved?Math.max(previous.best??0,result.accuracy)+'%':previous.best===undefined?'—':previous.best+'%';el('changesRoundPreviousBest').textContent=record?(previous.best===undefined?'First personal best':'Previous best: '+previous.best+'%'):'';
 el('changesRoundSave').textContent=saved?'✓ Saved in this browser':'Could not save in this browser';el('changesRoundSave').classList.toggle('save-error',!saved);
 say(result.matches+' of '+result.changes+' changes matched · '+result.accuracy+'% accuracy.');el('changesRoundResult').showModal();
 if(record&&context.state==='running'){const v={voices:[]};for(const [notes,delay,duration,volume] of [[[392,523.25,659.25,783.99],0,.16,.045],[[523.25,659.25,783.99,1046.5],.23,.95,.055]])for(const n of notes)tone(v,n,context.currentTime+.03+delay,duration,volume,'triangle');}
}
function tick(r){
 if(run!==r)return;
 if(document.hidden){cancel('Paused. Start a fresh round when ready.');return;}
 if(performance.now()-r.lastReceived>1800){cancel('Microphone audio interrupted. This round was not saved.');return;}
 const now=context.currentTime,elapsed=now-r.start,beat=r.engine.beat;
 // Schedule a short lookahead; missed browser ticks never create a burst of old clicks.
 while(r.nextBeat<r.engine.beats*(r.config.changes+2)&&r.anchor+r.nextBeat*beat<now+.15){const at=r.anchor+r.nextBeat*beat;if((r.nextBeat<r.engine.beats||r.config.metronome==='on')&&at>=now-.02)tone(r,r.nextBeat%r.engine.beats===0?2400:r.engine.compound&&r.nextBeat%3===0?2100:1800,Math.max(at,now+.005),.045,.09);r.nextBeat++;}
 if(elapsed<0){r.phase='countin';const count=Math.min(r.engine.beats,Math.max(1,Math.ceil(-elapsed/beat)));el('changesCountInNumber').textContent=count;el('changesTime').textContent='Get ready';return;}
 el('changesCountIn').close();r.phase=elapsed>=r.engine.duration?'finishing':'playing';const state=r.engine.at(elapsed);
 if(r.bar!==state.index){r.bar=state.index;draw();say(state.index?'Change on beat 1 · strum '+state.target+' on every beat.':'Starting chord '+state.target+' · change at the next bar.');}
 el('changesTime').textContent=state.done?'Finishing…':state.index?'Change '+state.index+' / '+r.config.changes:'Starting bar';const strums=r.engine.strumResult();el('changesCount').textContent=r.engine.matched.size+' changes · '+strums.detected+'/'+strums.expected+' strums';
 [...el('barBeats').children].forEach((e,i)=>{e.classList.toggle('current',!state.done&&i===state.beat);const offset=r.engine.attacks.get(state.index*r.engine.beats+i);e.classList.toggle('on-beat',offset!==undefined&&Math.abs(offset)<=r.engine.timingWindow);e.classList.toggle('off-beat',offset!==undefined&&Math.abs(offset)>r.engine.timingWindow);});
 el('changesDiagram').classList.toggle('matched',state.matched&&state.target===r.config.first);el('changesSecondDiagram').classList.toggle('matched',state.matched&&state.target===r.config.second);
 if(elapsed>=r.engine.duration+.6)finish(r);
}
function receive(r,chord,sample){
 if(run!==r||r.controller.signal.aborted)return;
 r.lastReceived=performance.now();
 if(r.phase==='connecting'){
  if(typeof sample?.audioPcm16==='string'){r.captureOrigin=context.currentTime-Math.max(0,sample.captureAgeSeconds||0)-sample.capturedSeconds;r.strumDetector.process(GuitarStrumTiming.decode(sample.audioPcm16));}
  clearTimeout(r.readyTimeout);r.anchor=context.currentTime+.15;r.start=r.anchor+r.engine.beats*r.engine.beat;r.nextBeat=0;r.phase='countin';
  el('changesCountInNumber').textContent=r.engine.beats;el('changesCountIn').showModal();say('One-bar count-in · then play '+r.config.first+'.');
  r.timer=setInterval(()=>tick(r),25);tick(r);return;
 }
 let strumTimes=[];
 if(typeof sample?.audioPcm16==='string'){
  if(!Number.isFinite(r.captureOrigin))r.captureOrigin=context.currentTime-Math.max(0,sample.captureAgeSeconds||0)-sample.capturedSeconds;
  r.strumDetector.acceptAfter=r.start-r.captureOrigin+r.correction-r.engine.beat*.45;
  strumTimes=r.strumDetector.process(GuitarStrumTiming.decode(sample.audioPcm16)).map(time=>r.captureOrigin+time-r.start-r.correction);
 }else for(const attack of sample?.strums||[])if(Number.isFinite(attack.ageSeconds))strumTimes.push(context.currentTime-r.start-Math.max(0,attack.ageSeconds)-r.correction);
 for(const time of strumTimes){if(r.engine.strum(time)){const result=r.engine.lastStrum;el('barTimingFeedback').dataset.result=result.status;el('barTimingGuide').textContent=result.status==='early'?'Too early · wait for the beat':result.status==='late'?'Too late · strum sooner':'✓ On time';const ms=Math.round(Math.abs(result.offset)*1000);el('barTimingOffset').textContent='Beat '+(result.index%r.engine.beats+1)+' · '+ms+' ms'+(result.status==='early'?' early':result.status==='late'?' late':' from beat');}}

 const age=Number.isFinite(sample?.ageSeconds)?Math.max(0,Math.min(1,sample.ageSeconds)):.128;
 if(r.engine.observe(chord,context.currentTime-r.start-age-r.correction)){tick(r);if(run===r&&r.engine.at(Math.max(0,context.currentTime-r.start)).matched)say('✓ Matched '+chord+' · keep strumming on each beat.');}
}
el('changesStart').onclick=async()=>{
 if(run)return;
 let startingRun=null;
 try{
  const c=settings(),a=GuitarChords.parse(c.first),b=GuitarChords.parse(c.second);
  if([...a.notes].sort().join(',')===[...b.notes].sort().join(',')){say('Choose chords with different notes.');return;}
  el('barTimingGuide').textContent='Strum on each beat';el('barTimingOffset').textContent='';delete el('barTimingFeedback').dataset.result;
  const engine=new BarChordRound(c);remember();context??=new AudioContext();
  const r={engine,config:c,controller:new AbortController(),phase:'connecting',voices:[],correction:(window.GuitarTimingAdjustment?.get(el('changesDevice').value)||0)/1000,lastReceived:performance.now(),bar:-1,strumDetector:new GuitarStrumTiming.Detector({minimumGap:Math.min(.12,engine.beat*.6)})};startingRun=r;run=r;draw();say('Connecting to your microphone…');
  await context.resume();if(run!==r)return;if(document.hidden){cancel('Start cancelled. Return to start a fresh round.');return;}
  r.readyTimeout=setTimeout(()=>{if(run===r)cancel('No microphone audio. Check the device and start again.');},8000);
  PiMicrophone.listenChords(el('changesDevice').value,[c.first,c.second],0,r.controller.signal,(chord,sample)=>receive(r,chord,sample),{includeAudio:true}).then(()=>{if(run===r)cancel('Microphone stopped. This round was not saved.');}).catch(e=>{if(run===r&&!r.controller.signal.aborted)cancel(e.message);});
 }catch(e){if(!startingRun||run===startingRun)cancel(e.message);}
};
el('changesDevice').onchange=()=>PiMicrophone.remember(el('changesDevice').value);
el('changesCancel').onclick=()=>cancel();el('barActiveCancel').onclick=()=>cancel();el('changesCountInCancel').onclick=()=>cancel();el('changesCountIn').addEventListener('cancel',e=>{e.preventDefault();cancel();});
el('changesBack').onclick=()=>{halt();location.href='/practice.html?tab=practice';};
el('changesRoundClose').onclick=()=>el('changesRoundResult').close();el('changesRoundAgain').onclick=()=>{el('changesRoundResult').close();el('changesStart').click();};
el('changesHistory').onclick=()=>{const list=el('changesResultsList');list.replaceChildren();for(const row of history){const line=document.createElement('div');line.className='changeresult';const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=row.first+' ↔ '+row.second+' · '+row.accuracy+'%';detail.textContent=row.matches+'/'+row.changes+' matched · '+row.bpm+' BPM · '+(row.meter||'4/4')+(row.strumming?' · Strums '+row.strumming.accuracy+'% ('+row.strumming.detected+'/'+row.strumming.expected+')':'')+' · '+new Date(row.finished).toLocaleString();line.append(title,detail);list.append(line);}if(!history.length)list.textContent='No completed rounds yet.';el('changesResults').showModal();};
el('changesRoundHistory').onclick=()=>{el('changesRoundResult').close();el('changesHistory').click();};el('changesCloseResults').onclick=()=>el('changesResults').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)cancel('Paused. Partial results are not saved.');});window.addEventListener('pagehide',()=>halt());
recentMenu();draw();
PiMicrophone.load(el('changesDevice')).then(result=>{available=result.available;say(result.missing?'Saved microphone unavailable. Choose a microphone.':available?'Change on beat 1 · headphones recommended for clicks.':result.message);draw();}).catch(e=>{say(e.message);draw();});
})();
