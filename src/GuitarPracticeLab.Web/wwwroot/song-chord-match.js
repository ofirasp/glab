(() => {
  'use strict';
  const device = $('chordMatchDevice'), launch = $('startChordMatch'), toggle = $('chordMatchButton');
  let run = null, capture = null, available = false, setupVersion = 0;
  const validRun = () => run && song?.id === run.id && song.chordAnalysis === run.analysis;

  function key() {
    // Reanalysis can change which chord sections count, even with the same MP3 and pitch shift.
    const timeline = JSON.stringify(song.chordAnalysis);
    let hash = 2166136261;
    for (let index = 0; index < timeline.length; index++) hash = Math.imul(hash ^ timeline.charCodeAt(index), 16777619);
    return `guitar-chord-best-${song.id}-${song.audioVersion}-${hash >>> 0}`;
  }
  function savedScore(suffix = '') {
    try { return JSON.parse(localStorage.getItem(key() + suffix)); } catch { return null; }
  }
  function showBest() {
    const record = savedScore();
    const last = savedScore('-last');
    $('chordMatchLast').textContent = last ? `Last score · ${last.percent}% (${last.hits} / ${last.total})` : '';
    $('chordMatchBest').textContent = record ? `Personal best · ${record.percent}% (${record.hits} / ${record.total})` : 'No personal best yet.';
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
    toggle.textContent = 'Chord match';
    toggle.setAttribute('aria-pressed', 'false');
    show(-1);
  }

  async function openSetup(result = '') {
    const version = ++setupVersion;
    closeDialog('toolsDialog');
    $('chordMatchResult').textContent = result;
    showBest();
    available = false;
    launch.disabled = true;
    openDialog('chordMatchDialog');
    try {
      const list = await PiMicrophone.load(device);
      if (version !== setupVersion || !$('chordMatchDialog').open) return;
      available = list.available;
      launch.disabled = !available || !device.value;
      if (!available) $('chordMatchResult').textContent = [result, list.message].filter(Boolean).join(' ');
    } catch (error) {
      if (version === setupVersion) $('chordMatchResult').textContent = [result, error.message].filter(Boolean).join(' ');
    }
  }

  async function listen() {
    if (!validRun() || capture || audio.paused || document.hidden || takingSongRecording) return;
    const current = run;
    const controller = new AbortController();
    capture = controller;
    try {
      await PiMicrophone.listenChords(current.device, current.names, current.analysis.shift, controller.signal, chord => {
        if (controller.signal.aborted || audio.paused || audio.seeking || run !== current) return;
        current.received = true;
        const index = chordIndexAt(audio.currentTime, current.analysis.changes);
        // Every confident reading can match the active section, at any point in it.
        if (chord && chord === current.analysis.changes[index]?.name) current.matched.add(index);
        show(index);
      });
    } catch (error) {
      if (!controller.signal.aborted && run === current) {
        stop();
        status('Chord match: ' + error.message);
        audio.pause();
        void openSetup(error.message);
      }
    } finally { if (capture === controller) capture = null; }
  }

  toggle.onclick = () => {
    if (validRun()) { stop(); status('Chord match off.'); return; }
    audio.pause();
    void openSetup();
  };
  device.onchange = () => {
    PiMicrophone.remember(device.value);
    launch.disabled = !available || !device.value;
  };
  launch.onclick = () => {
    const analysis = song.chordAnalysis;
    const sections = analysis.changes.filter(change => change.name);
    if (!sections.length || !device.value) return;
    stop();
    run = {id: song.id, analysis, device: device.value, total: sections.length,
      names: [...new Set(sections.map(change => change.name))], matched: new Set(), uninterrupted: true,
      received: false, initialSeek: audio.currentTime > 0};
    looping = false;
    if (run.initialSeek) audio.currentTime = 0;
    toggle.textContent = 'Chord match on · turn off';
    toggle.setAttribute('aria-pressed', 'true');
    closeDialog('chordMatchDialog');
    status('Chord match on. Play along through headphones.');
    audio.play().then(listen).catch(error => { stop(); message(error); });
  };
  audio.addEventListener('play', listen);
  audio.addEventListener('pause', cancelCapture);
  audio.addEventListener('seeking', () => {
    if (!validRun()) return;
    if (run.initialSeek && audio.currentTime < .1) return;
    run.uninterrupted = false;
  });
  audio.addEventListener('seeked', () => { if (validRun()) run.initialSeek = false; });
  audio.addEventListener('ended', () => {
    if (!validRun()) return;
    const {matched, total, uninterrupted, received} = run;
    const hits = matched.size;
    const percent = Math.round(100 * hits / total);
    let result = `Score · ${percent}% · ${hits} of ${total} chord sections matched.`;
    if (!received) result = 'No microphone readings received. Check your mic and try again.';
    else {
      try {
        const score = JSON.stringify({hits, total, percent});
        localStorage.setItem(key() + '-last', score);
        if (!uninterrupted || looping) result += ' Last score saved. Seeking or looping excludes it from your personal best.';
        else if (hits > (savedScore()?.hits ?? -1)) {
          localStorage.setItem(key(), score);
          result += ' New personal best!';
        } else result += ' Last score saved.';
      } catch { result += ' The browser could not save the score.'; }
    }
    stop();
    void openSetup(result);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && validRun()) { run.uninterrupted = false; cancelCapture(); }
    else void listen();
  });
  window.addEventListener('pagehide', stop);
  window.SongChordMatch = {show, stop, progress: () => validRun() ? {hits: run.matched.size, total: run.total} : null};
})();
