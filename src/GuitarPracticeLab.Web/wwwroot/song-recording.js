(() => {
  'use strict';
  const dialog = $('recordReviewDialog'), device = $('recordReviewDevice');
  const start = $('startTake'), cue = $('recordReviewCue');
  const accompaniment = new Audio(), guitar = new Audio();
  const rate = 16000, bytesPerSecond = rate * 2;
  let capture = null, takeUrl = '', sectionStart = 0, choices = [], available = false;
  let generation = 0, review = false, suspendedDialog = false;
  const say = text => { $('recordReviewStatus').textContent = text; };

  function sync() {
    start.disabled = !capture && (!available || !device.value);
    $('takeRecordingBanner').hidden = !capture;
    cue.disabled = device.disabled = Boolean(capture);
    $('recordReviewPlayback').hidden = !takeUrl || Boolean(capture);
    $('reviewGuitar').textContent = review ? 'Stop playback' : 'Guitar only';
    $('reviewMix').disabled = review;
  }

  function pauseReview() {
    review = false;
    guitar.pause();
    accompaniment.pause();
    sync();
  }

  function discardTake() {
    guitar.removeAttribute('src');
    if (takeUrl) URL.revokeObjectURL(takeUrl);
    takeUrl = '';
    $('downloadTake').removeAttribute('href');
  }

  function finish() {
    const current = capture;
    if (!current) return;
    capture = null;
    takingSongRecording = false;
    takePlayback = null;
    setFollow(false);
    current.controller.abort();
    accompaniment.pause();
    if (current.bytes % 2) {
      current.chunks.push(new Uint8Array(1));
      current.bytes++;
    }
    if (current.bytes) {
      discardTake();
      sectionStart = current.from;
      takeUrl = URL.createObjectURL(PiMicrophone.wave(current.chunks, current.bytes));
      guitar.src = takeUrl;
      $('downloadTake').href = takeUrl;
      say(`Take ready · ${(current.bytes / bytesPerSecond).toFixed(1)} seconds.`);
    } else say('No take recorded.');
    update();
    sync();
    openDialog('recordReviewDialog');
  }

  async function record() {
    if (capture) return;
    pauseReview();
    const {from, to, mark} = choices[Number(cue.value)];
    const maxBytes = Math.max(2, Math.floor(Math.min(60, to - from) * rate) * 2);
    const controller = new AbortController();
    const current = {controller, from, chunks: [], bytes: 0};
    capture = current;
    takingSongRecording = true;
    suspendedDialog = true;
    closeDialog('recordReviewDialog');
    setFollow(false);
    if (mark) seekPdf(mark);
    sync();
    $('takeRecordingStatus').textContent = 'Connecting mic…';
    try {
      accompaniment.currentTime = from;
      const response = await fetch('/api/chord-practice/record', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({device: device.value}), signal: controller.signal
      });
      if (!response.ok) throw Error((await response.json().catch(() => ({}))).message || 'Could not start recording.');
      const reader = response.body.getReader();
      try {
        // Discard the startup buffer and use playback start as the take's reference.
        await reader.read();
        if (capture !== current) return;
        await accompaniment.play();
        if (capture !== current) return;
        takePlayback = accompaniment;
        setFollow(Boolean(song.cues.length));
        tick();
        $('takeRecordingStatus').textContent = '● Recording';
        while (capture === current && current.bytes < maxBytes) {
          const {done, value} = await reader.read();
          if (done) break;
          if (capture !== current) return;
          const part = value.subarray(0, maxBytes - current.bytes);
          current.chunks.push(part);
          current.bytes += part.length;
        }
        if (capture === current) finish();
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (capture === current) {
        finish();
        say(error.message + (current.bytes ? ' The partial take is available.' : ''));
      }
    }
  }

  async function play(withBacking) {
    if (review) { pauseReview(); return; }
    if (!takeUrl) return;
    const version = generation;
    review = true;
    sync();
    try {
      guitar.currentTime = 0;
      accompaniment.currentTime = sectionStart;
      await Promise.all([guitar.play(), ...(withBacking ? [accompaniment.play()] : [])]);
      if (version === generation && review)
        say(withBacking ? 'Playing your take with the song track.' : 'Playing your guitar take.');
    } catch (error) {
      if (version === generation) { pauseReview(); say(error.message); }
    }
  }

  $('recordReviewButton').onclick = async () => {
    const version = ++generation;
    audio.pause();
    closeDialog('toolsDialog');
    const backing = song.hasBacking;
    accompaniment.src = `${api}/${song.id}/audio?variant=${backing ? 'backing' : 'original'}`;
    accompaniment.volume = audio.volume;
    accompaniment.muted = audio.muted;
    $('reviewMix').textContent = backing ? 'With backing' : 'With original';
    const duration = song.duration;
    choices = [{from: Math.min(audio.currentTime, Math.max(0, duration - 1)), to: duration, label: 'Current position'}];
    for (const [index, item] of song.cues.entries()) {
      const to = song.cues[index + 1]?.time ?? duration;
      if (to > item.time) choices.push({from: item.time, to, label: item.label, mark: item});
    }
    cue.replaceChildren(...choices.map(({from, label}, index) => new Option(`${clock(from)} · ${label}`, index)));
    available = false;
    sync();
    openDialog('recordReviewDialog');
    say('Finding the Pi microphone…');
    try {
      const result = await PiMicrophone.load(device);
      if (version !== generation) return;
      available = result.available;
      say(result.missing ? 'Choose a microphone.' : available ? 'Ready to record.' : result.message);
      sync();
    } catch (error) { if (version === generation) say(error.message); }
  };
  device.onchange = () => { PiMicrophone.remember(device.value); sync(); };
  start.onclick = record;
  $('stopTake').onclick = finish;
  $('reviewGuitar').onclick = () => play(false);
  $('reviewMix').onclick = () => play(true);
  guitar.onended = pauseReview;
  accompaniment.onended = () => { if (capture) finish(); };
  function close() {
    generation++;
    capture?.controller.abort();
    capture = null;
    if (takingSongRecording) setFollow(false);
    takingSongRecording = false;
    takePlayback = null;
    pauseReview();
    update();
    accompaniment.removeAttribute('src');
    accompaniment.load();
    discardTake();
  }
  dialog.addEventListener('close', () => {
    if (suspendedDialog) { suspendedDialog = false; return; }
    close();
  });
  window.addEventListener('pagehide', close);
})();
