(() => {
'use strict';
const el=id=>document.getElementById(id);
const reducedMetronomeMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const qualities=[['','Major'],['m','Minor (m)'],['7','7 · Dominant'],['maj7','Major 7'],['m7','Minor 7'],['sus2','Sus2'],['sus4','Sus4'],['5','Power (5)'],['6','Major 6'],['m6','Minor 6'],['add9','Add9'],['madd9','Minor add9'],['6add9','6 add9'],['dim','Diminished'],['dim7','Diminished 7'],['aug','Augmented'],['m7b5','Minor 7♭5'],['9','Dominant 9'],['m9','Minor 9'],['maj9','Major 9'],['7sus4','7 sus4'],['7sus2','7 sus2'],['7b5','7♭5'],['7#5','7♯5'],['7b9','7♭9'],['7#9','7♯9']];
const roots=[['C','C'],['C#','C♯ / D♭'],['D','D'],['Eb','E♭ / D♯'],['E','E'],['F','F'],['F#','F♯ / G♭'],['G','G'],['Ab','A♭ / G♯'],['A','A'],['Bb','B♭ / A♯'],['B','B']];
let available=false,run=null,context=null,history=[],lastResult=null;
const storage='guitar-bar-change-results',recentKey='guitar-recent-chord-pairs';
try{const rows=JSON.parse(localStorage.getItem(storage)||'[]');if(Array.isArray(rows))history=rows.filter(r=>r&&typeof r.first==='string'&&Number.isFinite(r.accuracy)&&r.accuracy>=0&&r.accuracy<=100).slice(0,100);}catch{}
const patternKey='guitar-bar-strumming-patterns-v1';let patternState={selected:{},recent:[]},patternDraft=[];
try{const saved=JSON.parse(localStorage.getItem(patternKey)||'{}');for(const [meter,slots]of Object.entries(saved.selected||{})){try{patternState.selected[meter]=StrumPatterns.validate(slots,meter);}catch{}}for(const row of (Array.isArray(saved.recent)?saved.recent:[]).slice(0,8)){try{patternState.recent.push({meter:row.meter,slots:StrumPatterns.validate(row.slots,row.meter)});}catch{}}}catch{}
function currentPattern(){return StrumPatterns.validate(patternState.selected[el('barMeter').value],el('barMeter').value);}
function rememberPattern(meter,slots){patternState.selected[meter]=[...slots];patternState.recent=[{meter,slots:[...slots]},...patternState.recent.filter(row=>row.meter!==meter||row.slots.join('')!==slots.join(''))].slice(0,8);try{localStorage.setItem(patternKey,JSON.stringify(patternState));}catch{say('Pattern selected for this session; browser storage is unavailable.');}}
function renderPatternEditor(){
 const meter=el('barMeter').value,g=StrumPatterns.grid(meter);el('barPatternMeter').textContent=meter+' · '+(g.subdivisions===2?'each slot = ⅛ note · count 1 & 2 & …':'each slot = ⅛ note');
 const grid=el('barPatternGrid');grid.style.gridTemplateColumns='repeat('+g.length+',minmax(0,1fr))';grid.replaceChildren();
 patternDraft.forEach((stroke,slot)=>{const cell=document.createElement('div'),label=document.createElement('small'),button=document.createElement('button');label.textContent=slot%g.subdivisions===0?String(Math.floor(slot/g.subdivisions)+1):'&';button.textContent=StrumPatterns.arrow(stroke);button.type='button';button.dataset.stroke=stroke;button.setAttribute('aria-label','Strum slot '+label.textContent+' '+(stroke==='D'?'down':stroke==='U'?'up':'rest'));button.onclick=()=>{patternDraft[slot]=['-','D','U'][(['-','D','U'].indexOf(stroke)+1)%3];renderPatternEditor();};cell.append(label,button);grid.append(cell);});
 el('barPatternError').textContent=patternDraft.some(s=>s!=='-')?'':'Choose at least one strum.';el('barPatternApply').disabled=!patternDraft.some(s=>s!=='-');
}
function openPattern(){
 if(run)return;patternDraft=currentPattern();const meter=el('barMeter').value;el('barPatternPresets').replaceChildren();for(const preset of StrumPatterns.presets(meter)){const button=document.createElement('button');button.textContent=preset.name;button.onclick=()=>{patternDraft=[...preset.slots];renderPatternEditor();};el('barPatternPresets').append(button);}
 el('barPatternRecent').replaceChildren();const rows=patternState.recent.filter(row=>row.meter===meter).slice(0,4);if(!rows.length)el('barPatternRecent').textContent='Your chosen patterns will appear here.';for(const row of rows){const button=document.createElement('button');button.textContent=StrumPatterns.label(row.slots,meter);button.onclick=()=>{patternDraft=[...row.slots];renderPatternEditor();};el('barPatternRecent').append(button);}
 renderPatternEditor();el('barPatternDialog').showModal();
}
el('barPatternButton').onclick=openPattern;el('barPatternCancel').onclick=()=>el('barPatternDialog').close();el('barPatternApply').onclick=()=>{const meter=el('barMeter').value;const slots=StrumPatterns.validate(patternDraft,meter);rememberPattern(meter,slots);el('barPatternDialog').close();draw();};
const picks={changesFirst:{name:'',index:0},changesSecond:{name:'',index:0}};
const name=id=>el(id).value+el(id+'Type').value;
const settings=()=>({first:name('changesFirst'),second:name('changesSecond'),bpm:Number(el('barTempo').value),changes:Number(el('barCount').value),meter:el('barMeter').value,metronome:el('barMetronome').value,pattern:currentPattern()});
const key=r=>JSON.stringify([r.first,r.second,r.bpm,r.changes,r.metronome,r.meter||'4/4',StrumPatterns.validate(r.pattern,r.meter||'4/4').join('')]);
const scores=config=>{const rows=history.filter(r=>key(r)===key(config));return {last:rows[0]?.accuracy,best:rows.length?Math.max(...rows.map(r=>r.accuracy)):undefined};};
function say(message){el('changesMessage').textContent=message;}
for(const id of ['changesFirst','changesSecond']){
 for(const [value,label] of roots)el(id).add(new Option(label,value));
 for(const [value,label] of qualities)el(id+'Type').add(new Option(label,value));
 el(id).value=id==='changesFirst'?'C':'G';
}
// Touch arrows avoid a long dropdown and do not open the on-screen keyboard.
for(const [field,min,max] of [['barTempo',20,180],['barCount',1,128]])for(const [suffix,step] of [['Up',1],['Down',-1]]){
 let delay=null,repeat=null,started=0,active=false,suppressClick=false;
 const stop=()=>{active=false;clearTimeout(delay);clearInterval(repeat);delay=repeat=null;};
 const change=(amount=1)=>{if(run)return;const old=Number(el(field).value),next=amount===1?old+step:step>0?(Math.floor(old/amount)+1)*amount:(Math.ceil(old/amount)-1)*amount;el(field).value=Math.max(min,Math.min(max,next));draw();if(Number(el(field).value)===min||Number(el(field).value)===max)stop();};
 const button=el(field+suffix);button.title='Tap: 1 · hold: faster steps of 5, then 10';
 button.onclick=e=>{if(suppressClick&&e.detail!==0){suppressClick=false;return;}suppressClick=false;change();};
 button.onpointerdown=e=>{if(button.disabled||run||e.button!==0)return;stop();suppressClick=false;active=true;started=performance.now();button.setPointerCapture(e.pointerId);const repeatStep=()=>{if(!active)return;const age=performance.now()-started;suppressClick=true;change(age>=2000?10:age>=1000?5:1);};delay=setTimeout(()=>{repeatStep();if(active)repeat=setInterval(repeatStep,120);},400);};
 button.onpointerup=button.onlostpointercapture=stop;button.onpointercancel=()=>{suppressClick=true;stop();};button.onblur=stop;
 window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
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
 const pattern=currentPattern(),grid=StrumPatterns.grid(el('barMeter').value),signature=el('barMeter').value+pattern.join('');
 if(el('barBeats').dataset.pattern!==signature){el('barBeats').dataset.pattern=signature;el('barBeats').replaceChildren(...Array.from({length:count},(_,i)=>{const s=document.createElement('span'),label=document.createElement('b'),strokes=document.createElement('i');label.textContent=i+1;s.append(label,strokes);for(let sub=0;sub<grid.subdivisions;sub++){const slot=i*grid.subdivisions+sub,arrow=document.createElement('em');arrow.textContent=StrumPatterns.arrow(pattern[slot]);arrow.dataset.slot=slot;arrow.classList.toggle('rest',pattern[slot]==='-');strokes.append(arrow);}if(i===0||(el('barMeter').value.endsWith('/8')&&i%3===0))s.className='accent';return s;}));}
 el('barPatternButton').title=StrumPatterns.label(pattern,el('barMeter').value);
 el('barBeats').setAttribute('aria-label',el('barMeter').value+' beats');
 const busy=Boolean(run),playing=busy&&['playing','finishing'].includes(run.phase);
 document.querySelector('.changesbody').classList.toggle('bar-exercise-active',busy);
 document.querySelector('.changessetup').inert=busy;
 document.querySelector('.changessetup').setAttribute('aria-hidden',String(busy));
 el('barActiveCancel').hidden=!busy;el('barTimingFeedback').hidden=!playing;el('barVisualMetronome').hidden=!playing;
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
 for(const id of ['changesFirst','changesFirstType','changesSecond','changesSecondType','changesDevice','barTempo','barTempoUp','barTempoDown','barCount','barCountUp','barCountDown','barMeter','barMetronome','changesRecent','barPatternButton'])el(id).disabled=busy;
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
function halt(){const r=run;run=null;if(!r)return;clearInterval(r.timer);clearTimeout(r.readyTimeout);cancelAnimationFrame(r.metroFrame);r.controller.abort();for(const v of r.voices)try{v.stop();}catch{}el('changesCountIn').close();[...el('barBeats').children].forEach(e=>e.classList.remove('current'));draw();}
function cancel(message='Round cancelled. Partial results are not saved.'){halt();say(message);}
function finish(r){
 if(run!==r)return;
 const result={...r.engine.result(),metronome:r.config.metronome,calibrationMs:Math.round(r.correction*1000),finished:new Date().toISOString()};const previous=scores(result);halt();
 let saved=true;const updated=[result,...history].slice(0,100);try{localStorage.setItem(storage,JSON.stringify(updated));history=updated;}catch{saved=false;}
 lastResult=result;draw();el('changesTime').textContent='Complete';el('changesCount').textContent=result.matches+' matches';
 const record=saved&&result.accuracy>0&&(previous.best===undefined||result.accuracy>previous.best);
 el('changesRoundResult').classList.toggle('new-best',record);el('changesRoundIcon').textContent=record?'★':'✓';el('changesRoundTitle').textContent=record?'New personal best!':'Round complete';
 el('changesRoundPair').textContent=result.first+' ↔ '+result.second+' · '+result.bpm+' BPM · '+result.meter+' · '+StrumPatterns.label(result.pattern,result.meter);el('changesRoundScore').textContent=result.accuracy+'%';
 el('barResultMatches').textContent=result.matches+' / '+result.changes+' changes matched';el('barStrumScore').textContent=result.strumming.accuracy+'%';el('barStrumDetail').textContent=result.strumming.detected+' / '+result.strumming.expected+' strums · '+result.strumming.onTime+' on beat · '+result.strumming.early+' early · '+result.strumming.late+' late · '+result.strumming.missed+' missed · '+result.strumming.extra+' extra';
 const mean=result.strumming.meanOffsetMs;el('barTimingSummary').textContent='Calibration '+(result.calibrationMs>=0?'+':'')+result.calibrationMs+' ms'+(mean===null?'':' · Average '+Math.abs(mean)+' ms '+(mean<0?'early':'late'))+' · Window ±'+result.strumming.toleranceMs+' ms';
 el('changesRoundLast').textContent=previous.last===undefined?'—':previous.last+'%';const delta=previous.last===undefined?null:result.accuracy-previous.last;
 el('changesRoundDifference').textContent=delta===null?'First round':delta===0?'Same as last':(delta>0?'+':'')+delta+' pts';el('changesRoundDifference').classList.toggle('improved',delta>0);
 el('changesRoundBest').textContent=saved?Math.max(previous.best??0,result.accuracy)+'%':previous.best===undefined?'—':previous.best+'%';el('changesRoundPreviousBest').textContent=record?(previous.best===undefined?'First personal best':'Previous best: '+previous.best+'%'):'';
 el('changesRoundSave').textContent=saved?'✓ Saved in this browser':'Could not save in this browser';el('changesRoundSave').classList.toggle('save-error',!saved);
 say(result.matches+' of '+result.changes+' changes matched · '+result.accuracy+'% accuracy.');el('changesRoundResult').showModal();
 if(record&&context.state==='running'){const v={voices:[]};for(const [notes,delay,duration,volume] of [[[392,523.25,659.25,783.99],0,.16,.045],[[523.25,659.25,783.99,1046.5],.23,.95,.055]])for(const n of notes)tone(v,n,context.currentTime+.03+delay,duration,volume,'triangle');}
}
function animateMetronome(r){
 if(run!==r||r.controller.signal.aborted)return;
 const elapsed=context.currentTime-r.start;if(elapsed<0||elapsed>=r.engine.duration){el('barVisualMetronome').hidden=true;r.metroFrame=null;return;}
 const pulse=elapsed/r.engine.beat,whole=Math.floor(pulse),beat=whole%r.engine.beats+1,phase=pulse-whole;
 const reduced=reducedMetronomeMotion.matches;
 const angle=reduced?0:-32*Math.cos(Math.PI*pulse),flash=Math.exp(-phase*15);
 el('barMetroArm').setAttribute('transform','rotate('+angle.toFixed(3)+' 100 64)');
 el('barVisualMetronome').classList.toggle('downbeat',beat===1);el('barVisualMetronome').style.setProperty('--metro-flash',flash.toFixed(3));
 el('barMetroLight').setAttribute('opacity',String(.18+.82*flash));el('barMetroLight').setAttribute('r',beat===1?'7':'5');el('barMetroBeat').textContent=beat;el('barMetroTempo').textContent=r.config.bpm+' BPM · '+r.config.meter;
 r.metroFrame=requestAnimationFrame(()=>animateMetronome(r));
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
 if(r.bar!==state.index){r.bar=state.index;draw();say(state.index?'Change on beat 1 · follow the arrows with '+state.target+'.':'Starting chord '+state.target+' · change at the next bar.');}
 if(!r.metroFrame&&!state.done)animateMetronome(r);
 el('changesTime').textContent=state.done?'Finishing…':state.index?'Change '+state.index+' / '+r.config.changes:'Starting bar';const strums=r.engine.strumResult();el('changesCount').textContent=r.engine.matched.size+' changes · '+strums.detected+'/'+strums.expected+' strums';
 [...el('barBeats').children].forEach((e,i)=>{e.classList.toggle('current',!state.done&&i===state.beat);const planned=[];for(const arrow of e.querySelectorAll('[data-slot]')){const slot=Number(arrow.dataset.slot),target=r.engine.targetBySlot.get(state.index+':'+slot),offset=target?r.engine.attacks.get(target.index):undefined;arrow.classList.toggle('stroke-now',!state.done&&Math.floor(Math.max(0,elapsed-state.index*r.engine.bar)/r.engine.slotDuration)===slot);arrow.classList.toggle('hit',offset!==undefined&&Math.abs(offset)<=r.engine.timingWindow);arrow.classList.toggle('off',offset!==undefined&&Math.abs(offset)>r.engine.timingWindow);if(target)planned.push(offset);}e.classList.toggle('on-beat',planned.length>0&&planned.every(v=>v!==undefined&&Math.abs(v)<=r.engine.timingWindow));e.classList.toggle('off-beat',planned.some(v=>v!==undefined&&Math.abs(v)>r.engine.timingWindow));});
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
 for(const time of strumTimes){if(r.engine.strum(time)){const result=r.engine.lastStrum;el('barTimingFeedback').dataset.result=result.status;el('barTimingGuide').textContent=result.status==='early'?'Too early · wait for the beat':result.status==='late'?'Too late · strum sooner':'✓ On time';const ms=Math.round(Math.abs(result.offset)*1000);el('barTimingOffset').textContent='Beat '+(result.beat+1)+(result.slot%r.engine.subdivisions?' &':'')+' '+StrumPatterns.arrow(result.stroke)+' · '+ms+' ms'+(result.status==='early'?' early':result.status==='late'?' late':' from beat');}}

 const age=Number.isFinite(sample?.ageSeconds)?Math.max(0,Math.min(1,sample.ageSeconds)):.128;
 if(r.engine.observe(chord,context.currentTime-r.start-age-r.correction)){tick(r);if(run===r&&r.engine.at(Math.max(0,context.currentTime-r.start)).matched)say('✓ Matched '+chord+' · follow the arrows.');}
}
el('changesStart').onclick=async()=>{
 if(run)return;
 let startingRun=null;
 try{
  const c=settings(),a=GuitarChords.parse(c.first),b=GuitarChords.parse(c.second);
  if([...a.notes].sort().join(',')===[...b.notes].sort().join(',')){say('Choose chords with different notes.');return;}
  el('barTimingGuide').textContent='Follow the arrows';el('barTimingOffset').textContent='';delete el('barTimingFeedback').dataset.result;
  const engine=new BarChordRound(c);rememberPattern(c.meter,c.pattern);remember();context??=new AudioContext();
  const r={engine,config:c,controller:new AbortController(),phase:'connecting',voices:[],correction:(window.GuitarTimingAdjustment?.get(el('changesDevice').value)||0)/1000,lastReceived:performance.now(),bar:-1,strumDetector:new GuitarStrumTiming.Detector({minimumGap:Math.min(.12,engine.strumStep*.6)})};startingRun=r;run=r;draw();say('Connecting to your microphone…');
  await context.resume();if(run!==r)return;if(document.hidden){cancel('Start cancelled. Return to start a fresh round.');return;}
  r.readyTimeout=setTimeout(()=>{if(run===r)cancel('No microphone audio. Check the device and start again.');},8000);
  PiMicrophone.listenChords(el('changesDevice').value,[c.first,c.second],0,r.controller.signal,(chord,sample)=>receive(r,chord,sample),{includeAudio:true}).then(()=>{if(run===r)cancel('Microphone stopped. This round was not saved.');}).catch(e=>{if(run===r&&!r.controller.signal.aborted)cancel(e.message);});
 }catch(e){if(!startingRun||run===startingRun)cancel(e.message);}
};
el('changesDevice').onchange=()=>PiMicrophone.remember(el('changesDevice').value);
el('changesCancel').onclick=()=>cancel();el('barActiveCancel').onclick=()=>cancel();el('changesCountInCancel').onclick=()=>cancel();el('changesCountIn').addEventListener('cancel',e=>{e.preventDefault();cancel();});
el('changesBack').onclick=()=>{halt();location.href='/practice.html?tab=practice';};
el('changesRoundClose').onclick=()=>el('changesRoundResult').close();el('changesRoundAgain').onclick=()=>{el('changesRoundResult').close();el('changesStart').click();};
el('changesHistory').onclick=()=>{const list=el('changesResultsList');list.replaceChildren();for(const row of history){const line=document.createElement('div');line.className='changeresult';const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=row.first+' ↔ '+row.second+' · '+row.accuracy+'%';detail.textContent=row.matches+'/'+row.changes+' matched · '+row.bpm+' BPM · '+(row.meter||'4/4')+(row.pattern?' · '+StrumPatterns.label(row.pattern,row.meter||'4/4'):'')+(row.strumming?' · Strums '+row.strumming.accuracy+'% ('+row.strumming.detected+'/'+row.strumming.expected+')':'')+' · '+new Date(row.finished).toLocaleString();line.append(title,detail);list.append(line);}if(!history.length)list.textContent='No completed rounds yet.';el('changesResults').showModal();};
el('changesRoundHistory').onclick=()=>{el('changesRoundResult').close();el('changesHistory').click();};el('changesCloseResults').onclick=()=>el('changesResults').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)cancel('Paused. Partial results are not saved.');});window.addEventListener('pagehide',()=>halt());
recentMenu();draw();
PiMicrophone.load(el('changesDevice')).then(result=>{available=result.available;say(result.missing?'Saved microphone unavailable. Choose a microphone.':available?'Change on beat 1 · headphones recommended for clicks.':result.message);draw();}).catch(e=>{say(e.message);draw();});
})();
