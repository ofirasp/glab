(() => {
  'use strict';
  const device = $('chordMatchDevice'), launch = $('startChordMatch'), toggle = $('chordMatchButton');
  let run = null, capture = null, available = false, starting = false;
  const validRun = () => run && song?.id === run.id && activeChordAnalysis() === run.analysis;

  function key() {
    // Reanalysis can change which chord sections count, even with the same MP3 and pitch shift.
    const mapped = activeChordAnalysis().changes.map(change => ({...change,name:playbackChord(change.name)}));
    const timeline = JSON.stringify({...activeChordAnalysis(), changes:mapped});
    let hash = 2166136261;
    for (let index = 0; index < timeline.length; index++) hash = Math.imul(hash ^ timeline.charCodeAt(index), 16777619);
    const correction=validRun()?run.correction:(window.GuitarTimingAdjustment?.get(device.value)||0);
    return `guitar-chord-best-${song.id}-${song.audioVersion}-${hash >>> 0}`+(correction?'-offset-'+correction:'');
  }
  function savedScore(suffix = '') {
    try { return JSON.parse(localStorage.getItem(key() + suffix)); } catch { return null; }
  }
  function showBest() {
    $('notesMatchScores').hidden=!activeChordAnalysis()?.changes?.length;
    if($('notesMatchScores').hidden)return;
    const record = savedScore();
    const last = savedScore('-last');
    const timingBest = savedScore('-timing-best-v1');
    $('chordTimingLast').textContent = last?.timing ? timingSummary(last.timing, 'Last timing') : '';
    $('chordTimingBest').textContent = timingBest ? `Timing personal best · ${timingBest.percent}%` : 'No timing personal best yet.';
    $('chordMatchLast').textContent = last ? `Last score · ${last.percent}% (${last.hits} / ${last.total})` : '';
    $('chordMatchBest').textContent = record ? `Personal best · ${record.percent}% (${record.hits} / ${record.total})` : 'No personal best yet.';
  }
  function timingSummary(timing, title = 'Change timing') {
    if (timing.percent === null) return title + ' · No chord changes to time.';
    const average = timing.averageMs === null ? '' : ` · average ${Math.abs(timing.averageMs)} ms ${timing.averageMs < 0 ? 'early' : 'late'}`;
    return `${title} · ${timing.percent}% · ${timing.detected} / ${timing.total} changes detected${average}.`;
  }
  function show(index) {
    const matched = Boolean(validRun() && run.matched.has(index));
    $('playingChord').classList.toggle('matched-chord', matched);
    $('stageCurrentCard').classList.toggle('matched', matched);
    $('stageMatch').textContent = matched ? '✓ Matched' : '';
    $('stageScore').textContent = validRun() ? `Matched ${run.matched.size} / ${run.total}` : 'Chord match off';
  }
  function cancelCapture() {
    capture?.abort();
    capture = null;
  }
  function stop() {
    cancelCapture();
    run = null;
    for(const button of [toggle,$('readerChordMatch'),$('stageChordMatch')]){if(!button)continue;button.title='Chord match';button.setAttribute('aria-label','Chord match');button.setAttribute('aria-pressed','false');}
    toggle.setAttribute('aria-pressed', 'false');
    $('chordTimingFeedback').hidden = true;
    show(-1);
  }

  function showSession(session) {
    const numeric=session.received;
    $('matchResultSong').textContent=song?.title||'Practice session';
    $('matchAccuracyPercent').textContent=numeric?session.percent+'%':'—';
    $('matchTimingPercent').textContent=numeric&&session.timing.percent!==null?session.timing.percent+'%':'—';
    $('matchAccuracyRing').style.setProperty('--sweep',((numeric?session.percent:0)*3.6)+'deg');
    $('matchTimingRing').style.setProperty('--sweep',((numeric?session.timing.percent||0:0)*3.6)+'deg');
    $('matchAccuracyDetail').textContent=numeric?`${session.hits} / ${session.total} chord sections matched`:'No microphone readings';
    $('matchTimingDetail').textContent=!numeric?'No timing readings':session.timing.total?`${session.timing.detected} / ${session.timing.total} changes detected`:'No changes to time';
    $('matchAccuracyBest').textContent=session.best===null?'No personal best yet':`Best ${session.best}%`+(session.newBest?' · New!':'');
    $('matchTimingRecord').textContent=session.timingBest===null?'No timing best yet':`Best ${session.timingBest}%`+(session.newTimingBest?' · New!':'');
    const offset=session.timing.averageMs;
    $('matchAverageOffset').textContent=!numeric||offset===null?'No timing measurements':`Average ${Math.abs(offset)} ms ${offset<0?'early':offset>0?'late':'offset'}`;
    $('matchMissedChanges').textContent=numeric&&session.timing.total?`${session.timing.missed} missed changes`:'';
    $('matchResultNotice').textContent=session.notice;
  }
  function openSetup(result, session) {
    if(!session)return;
    closeDialog('toolsDialog');
    $('chordMatchResult').textContent=result;
    $('chordMatchDialog').classList.add('match-results');
    $('matchResultOverview').hidden=false;
    $('chordMatchTitle').textContent='Practice complete';
    launch.textContent='Play again';launch.disabled=false;
    showSession(session);showBest();openDialog('chordMatchDialog');
  }
  async function startDirect(){
    if(starting)return;
    starting=true;
    const songId=song?.id;
    try{
      audio.pause();
      const list=await PiMicrophone.load(device);
      if(song?.id!==songId)return;
      if(!list.available||!device.value)throw Error(list.message||'Select an available microphone in Settings → Audio.');
      if(!activeChordAnalysis()?.changes?.some(change=>change.name))throw Error('Analyze this song’s chords first.');
      startMatch();
    }catch(error){status('Chord match: '+error.message);}
    finally{starting=false;}
  }

  async function listen() {
    if (!validRun() || capture || audio.paused || document.hidden || takingSongRecording) return;
    const current = run;
    const controller = new AbortController();
    capture = controller;
    try {
      await PiMicrophone.listenChords(current.device, current.names, current.analysis.shift, controller.signal, (chord, sample) => {
        if (controller.signal.aborted || audio.paused || audio.seeking || run !== current) return;
        current.received = true;
        const age = Number.isFinite(sample?.ageSeconds) ? Math.max(0, Math.min(1, sample.ageSeconds)) : .128;
        const heardAt=Math.max(0,audio.currentTime-(age+current.correction/1000)*audio.playbackRate);
        const index=chordIndexAt(heardAt,current.analysis.changes);
        if(chord&&chord===current.targets[index])current.matched.add(index);
        const feedback=current.timing.observe(chord,heardAt,audio.playbackRate);
        if (feedback) {
          const badge = $('chordTimingFeedback');
          badge.textContent = feedback.label + (Math.abs(feedback.offset)>.15 ? ` ${Math.round(Math.abs(feedback.offset)*1000)} ms` : '');
          badge.classList.toggle('on-time', feedback.label === 'On time ✓');
          badge.hidden = false;
        }
        show(chordIndexAt(audio.currentTime,current.analysis.changes));
      });
    } catch (error) {
      if (!controller.signal.aborted && run === current) {
        stop();
        status('Chord match: ' + error.message);
        audio.pause();

      }
    } finally { if (capture === controller) capture = null; }
  }

  toggle.onclick = () => {
    if (validRun()) { stop(); status('Chord match off.'); return; }
    audio.pause();
    void startDirect();
  };
  device.onchange = () => {
    PiMicrophone.remember(device.value);
    showBest();
    launch.disabled = !available || !device.value;
  };
  launch.onclick = startDirect;
  function startMatch() {
    const analysis = activeChordAnalysis();
    const sections = analysis.changes.filter(change => change.name);
    if (!sections.length || !device.value) return;
    stop();
    run = {id: song.id, analysis, device: device.value, total: sections.length,
      targets: analysis.changes.map(change => playbackChord(change.name)),
      names: [...new Set(sections.map(change => playbackChord(change.name)))], matched: new Set(), uninterrupted: true,
      correction: window.GuitarTimingAdjustment?.get(device.value)||0,
      timing: ChordChangeTiming.create(analysis.changes, playbackChord),
      received: false, initialSeek: audio.currentTime > 0};
    looping = false;
    if (run.initialSeek) audio.currentTime = 0;
    for(const button of [toggle,$('readerChordMatch'),$('stageChordMatch')]){if(!button)continue;button.title='Chord match on · turn off';button.setAttribute('aria-label','Chord match on · turn off');button.setAttribute('aria-pressed','true');}
    toggle.setAttribute('aria-pressed', 'true');
    closeDialog('chordMatchDialog');
    status('Chord match on. Play along through headphones.');
    startSongPlayback().then(started => { if (started) return listen(); stop(); }).catch(error => { stop(); message(error); });
  };
  audio.addEventListener('play', listen);
  audio.addEventListener('pause', () => { cancelCapture(); run?.timing.resetInput(); });
  audio.addEventListener('seeking', () => {
    if (!validRun()) return;
    if (run.initialSeek && audio.currentTime < .1) return;
    run.uninterrupted = false;
    run.timing.resetInput();
  });
  audio.addEventListener('seeked', () => { if (validRun()) run.initialSeek = false; });
  audio.addEventListener('ended', () => {
    if (!validRun()) return;
    const {matched, total, uninterrupted, received} = run;
    const hits = matched.size;
    const percent = Math.round(100 * hits / total);
    const timing = run.timing.result();
    const session={hits,total,percent,timing,received,best:savedScore()?.percent??null,timingBest:savedScore('-timing-best-v1')?.percent??null,newBest:false,newTimingBest:false,notice:received?'Last score saved.':'No microphone readings. Check the microphone in Settings.'};
    let result = `Chord match · ${percent}% · ${hits} of ${total} chord sections matched. ${timingSummary(timing)}`;
    if (!received) result = 'No microphone readings received. Check your mic and try again.';
    else {
      try {
        const score = JSON.stringify({hits, total, percent, timing});
        localStorage.setItem(key() + '-last', score);
        if (!uninterrupted || looping) {result += ' Last score saved. Seeking or looping excludes it from your personal best.';session.notice='Saved as practice only · seeking or looping excludes personal bests.';}
        else if (hits > (savedScore()?.hits ?? -1)) {
          localStorage.setItem(key(), score);
          result += ' New personal best!';session.newBest=true;
        } else result += ' Last score saved.';
        if (uninterrupted && !looping && timing.percent !== null && timing.percent > (savedScore('-timing-best-v1')?.percent ?? -1)) {
          localStorage.setItem(key() + '-timing-best-v1', JSON.stringify(timing));
          result += ' New timing personal best!';session.newTimingBest=true;
        }
        session.best=savedScore()?.percent??null;session.timingBest=savedScore('-timing-best-v1')?.percent??null;
        if(session.newBest||session.newTimingBest)session.notice='New personal best · saved!';
      } catch { result += ' The browser could not save the score.';session.notice='Could not save this score in the browser.'; }
    }
    stop();
    void openSetup(result,session);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && validRun()) { run.uninterrupted = false; cancelCapture(); }
    else void listen();
  });
  window.addEventListener('pagehide', stop);
  $('notesPanelNotes').append($('notesMatchScores'));
  new MutationObserver(()=>{if($('notesDialog').open){showBest();void PiMicrophone.load(device).then(()=>{if($('notesDialog').open)showBest();}).catch(()=>{});}}).observe($('notesDialog'),{attributes:true,attributeFilter:['open']});
  window.SongChordMatch = {show, stop, matched: index => Boolean(validRun() && run.matched.has(index)), progress: () => validRun() ? {hits: run.matched.size, total: run.total} : null};
})();
