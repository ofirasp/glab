(() => {
  'use strict';
  const standalone=location.pathname.endsWith('/audio-settings.html');
  const $=id=>document.getElementById(id);
  const pauseAudio=()=>{if(typeof audio!=='undefined')audio.pause();window.SongChordMatch?.stop();};
  const dialog=$('timingCalibrationDialog'),device=$('calibrationDevice'),tempo=$('calibrationTempo');
  let context=null,capture=null,clocks=[],tones=[],draft=0,requestVersion=0,loaded=false,previewing=false;
  const say=text=>$('calibrationStatus').textContent=text;
  const display=()=>{$('calibrationOffset').textContent=(draft>=0?'+':'')+draft+' ms';};
  function stop(){capture?.abort();capture=null;clocks.forEach(clearTimeout);clocks=[];for(const tone of tones){try{tone.stop();}catch{}}tones=[];$('calibrationPulse').classList.remove('flash','heard','strum');previewing=false;tempo.disabled=false;$('startTimingCalibration').textContent='Start calibration';$('previewTimingCalibration').textContent='♪ Hear pulse';for(const id of ['applyTimingCalibration','calibrationMinus','calibrationPlus'])$(id).disabled=false;}
  function close(){if(typeof busy!=='undefined'&&busy)return;stop();requestVersion++;if(standalone){location.href='/practice.html';return;}dismissDialog('timingCalibrationDialog');}
  function pulse(time,index,mode='strum'){
    const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.value=2400;
    gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(.07,time+.004);gain.gain.exponentialRampToValueAtTime(.0001,time+.045);
    oscillator.connect(gain).connect(context.destination);oscillator.start(time);oscillator.stop(time+.05);tones.push(oscillator);
    clocks.push(setTimeout(()=>{const circle=$('calibrationPulse');circle.textContent=mode==='strum'?'STRUM':mode==='ready'?4-index:index+1;circle.classList.toggle('strum',mode==='strum');circle.classList.add('flash');if(mode==='ready')say(`Get ready · ${4-index} · Do not strum yet`);if(mode==='strum'){say(`Strum ${index+1} of 8 · once with this beep`);$('calibrationBeats').querySelectorAll('i').forEach((node,i)=>node.classList.toggle('current',i===index));}clocks.push(setTimeout(()=>circle.classList.remove('flash'),220));},Math.max(0,(time-context.currentTime)*1000)));
  }
  async function open(){
    if(!standalone&&(takingSongRecording||isRecordingFollow())){status('Stop recording before adjusting microphone timing.');return;}
    pauseAudio();stop();if(!standalone){closeDialog('toolsDialog');closeDialog('chordMatchDialog');}
    if(!standalone)openDialog('timingCalibrationDialog');const version=++requestVersion;loaded=false;$('startTimingCalibration').disabled=true;
    $('calibrationSuggestion').textContent='—';$('calibrationPulse').textContent='♪';$('calibrationBeats').replaceChildren(...Array.from({length:8},()=>document.createElement('i')));
    say('Loading the microphone…');
    try{const result=await PiMicrophone.load(device);if(version!==requestVersion||!dialog.open)return;loaded=result.available&&!result.missing;draft=GuitarTimingAdjustment.get(device.value);display();say(loaded?'First hear the slow pulse, or press Start. Wait for the count-in before strumming.':result.message||'Choose an available microphone.');}
    catch(error){say(error.message);}
    finally{if(version===requestVersion)$('startTimingCalibration').disabled=!loaded;}
  }
  for(const id of ['timingCalibrationButton','matchTimingCalibration'])if($(id))$(id).onclick=open;
  $('closeTimingCalibration').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopImmediatePropagation();close();},{capture:true});
  device.onchange=()=>{stop();PiMicrophone.remember(device.value);draft=GuitarTimingAdjustment.get(device.value);display();$('calibrationSuggestion').textContent='—';say('Microphone changed. Measure again or adjust manually.');};
  for(const[id,step]of [['calibrationMinus',-10],['calibrationPlus',10]])$(id).onclick=()=>{if(capture||previewing)return;draft=GuitarTimingAdjustment.limit(draft+step);display();};
  $('resetTimingCalibration').onclick=()=>{stop();draft=0;display();$('calibrationSuggestion').textContent='—';say('Correction reset to zero. Apply to save.');};
  $('applyTimingCalibration').onclick=()=>{
    if(!device.value||capture||previewing)return;
    try{GuitarTimingAdjustment.save(device.value,draft);PiMicrophone.remember(device.value);window.SongChordMatch?.stop();say('Saved. Bar Changes and song Chord Match now use this adjustment. Strumming Timing keeps its own timing reference.');$('calibrationHelp').textContent='Saved for '+device.value+'. Recheck after changing headphones or audio output.';}
    catch{say('The browser could not save this correction.');}
  };
  $('startTimingCalibration').onclick=async()=>{
    if(capture){stop();$('calibrationPulse').textContent='♪';say('Stopped. Your saved correction is unchanged.');return;}
    if(!loaded||!device.value)return;stop();tempo.disabled=true;$('startTimingCalibration').textContent='Stop';for(const id of ['applyTimingCalibration','calibrationMinus','calibrationPlus'])$(id).disabled=true;pauseAudio();
    const controller=new AbortController();capture=controller;
    let anchor,first,pulses=[],onsets=[],finished=false;
    const detector=new GuitarStrumTiming.Detector();
    $('calibrationBeats').querySelectorAll('i').forEach(node=>node.className='');$('calibrationSuggestion').textContent='—';say('Connecting…');
    const finish=()=>{
      if(finished||capture!==controller)return;finished=true;
      const result=GuitarTimingAdjustment.estimate(onsets,pulses);stop();$('calibrationPulse').textContent='♪';
      if(result.error){$('calibrationPulse').textContent='!';say(result.error);return;}$('calibrationPulse').textContent='✓';
      draft=result.milliseconds;display();$('calibrationSuggestion').textContent=(draft>=0?'+':'')+draft+' ms';
      say(`${result.count} / 8 strums measured. Apply correction, or try again.`);
      $('calibrationBeats').querySelectorAll('i').forEach((node,index)=>node.className=index<result.count?'done':'');
    };
    try{
      context??=new AudioContext();await context.resume();if(capture!==controller)return;
      await PiMicrophone.listenChords(device.value,['C','G'],0,controller.signal,(_chord,sample)=>{
        if(capture!==controller||controller.signal.aborted)return;
        if(typeof sample.audioPcm16!=='string'||!Number.isFinite(sample.capturedSeconds))throw Error('Update the Pi before calibrating microphone timing.');
        if(anchor===undefined){
          anchor=context.currentTime-Math.max(0,sample.captureAgeSeconds||0)-sample.capturedSeconds;
          const plan=GuitarTimingAdjustment.schedule(context.currentTime+.9,tempo.value);
          pulses=plan.strums;first=pulses[0];
          plan.countIn.forEach((time,index)=>pulse(time,index,'ready'));pulses.forEach((time,index)=>pulse(time,index,'strum'));
          say('Listen to the count-in. Do not strum yet.');clocks.push(setTimeout(finish,(pulses[7]+.6-context.currentTime)*1000));
        }
        detector.acceptAfter=first-anchor-.34;
        for(const attack of detector.process(GuitarStrumTiming.decode(sample.audioPcm16))){
          const time=anchor+attack;onsets.push(time);
          const beat=pulses.findIndex(p=>Math.abs(time-p)<.34);
          if(beat>=0){$('calibrationBeats').querySelectorAll('i')[beat]?.classList.add('done');$('calibrationPulse').classList.add('heard');clocks.push(setTimeout(()=>$('calibrationPulse').classList.remove('heard'),220));}
        }
      },{includeAudio:true});
    }catch(error){if(!controller.signal.aborted){stop();say(error.message);}}
    finally{if(capture===controller)stop();}
  };
  $('previewTimingCalibration').onclick=async()=>{
    if(capture)return;
    if(previewing){stop();$('calibrationPulse').textContent='♪';say('Pulse demonstration stopped.');return;}
    stop();previewing=true;tempo.disabled=true;$('previewTimingCalibration').textContent='■ Stop pulse';say('Listen only: one beep per beat. Start calibration afterwards to measure your strums.');
    try{context??=new AudioContext();await context.resume();if(!previewing)return;
      const start=context.currentTime+.8,period=60/Number(tempo.value);
      for(let i=0;i<4;i++)pulse(start+i*period,i,'demo');
      clocks.push(setTimeout(()=>{stop();$('calibrationPulse').textContent='♪';say('That is the pulse. Press Start, wait for 4 get-ready beats, then strum with each STRUM beep.');},(start+3*period+.4-context.currentTime)*1000));
    }catch(error){stop();say(error.message);}
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();if(dialog.open)say('Measurement stopped while the app was hidden. Try again.');}});
  window.addEventListener('pagehide',stop);
  if(standalone)open();
})();
