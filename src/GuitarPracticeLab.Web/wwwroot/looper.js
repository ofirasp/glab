(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const device = el('loopDevice'), audio = el('loopAudio'), api = '/api/guitar-loops';
  let capture = null, draft = null, draftUrl = '', loops = [], playing = '', available = false;
  let busy = false, pendingDelete = null, playbackVersion = 0;
  const say = text => { el('message').textContent = text; };
  const volume = el('loopVolume');
  const updateVolume = () => { audio.volume = Number(volume.value) / 100; };
  volume.oninput = updateVolume;
  updateVolume();

  async function request(path = '', options) {
    const response = await fetch(api + path, options);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Error(error.message || error.detail || 'Loop operation failed.');
    }
    return response.status === 204 ? null : response.json();
  }
  function controls() {
    const record = el('recordLoop');
    record.disabled = busy || (!capture && (!available || !device.value || Boolean(draft)));
    record.textContent = capture ? 'Stop recording' : 'Record';
    record.classList.toggle('recording', Boolean(capture));
    device.disabled = busy || Boolean(capture);
    el('loopDraft').hidden = !draft;
    el('previewLoop').textContent = playing === 'draft' ? 'Stop' : 'Preview';
    for (const id of ['previewLoop', 'discardLoop', 'saveLoop', 'loopName']) el(id).disabled = busy || Boolean(capture);
    el('saveLoop').disabled ||= !el('loopName').value.trim();
    for (const button of el('loops').querySelectorAll('button')) button.disabled = busy || Boolean(capture);
  }
  function draw() {
    const list = el('loops');
    list.replaceChildren();
    if (!loops.length) list.textContent = 'No saved loops yet.';
    for (const loop of loops) {
      const row = document.createElement('div');
      row.className = 'loop-row';
      const name = document.createElement('strong'), duration = document.createElement('span');
      name.className = 'loop-name';
      name.textContent = loop.name;
      duration.className = 'loop-duration';
      duration.textContent = loop.seconds.toFixed(1) + ' s';
      const play = document.createElement('button'), remove = document.createElement('button');
      play.textContent = playing === loop.id ? 'Stop' : 'Play loop';
      play.setAttribute('aria-label', (playing === loop.id ? 'Stop ' : 'Play ') + loop.name);
      play.dataset.mediaControl='playback';
      play.onclick = () => playLoop(loop.id, api + '/' + loop.id + '/audio');
      remove.textContent = 'Delete';
      remove.dataset.mediaControl = 'delete';
      remove.setAttribute('aria-label', 'Delete ' + loop.name);
      remove.onclick = () => {
        pendingDelete = loop;
        el('removeLoopName').textContent = loop.name;
        el('removeLoopDialog').returnValue = '';
        el('removeLoopDialog').showModal();
      };
      row.append(name, duration, play, remove);
      list.append(row);
    }
    controls();
  }
  function stopPlayback() {
    playbackVersion++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    playing = '';
  }
  async function playLoop(id, url) {
    const wasPlaying = playing === id;
    stopPlayback();
    if (wasPlaying) { draw(); say('Playback stopped.'); return; }
    const version = playbackVersion;
    playing = id;
    audio.src = url;
    draw();
    try {
      await audio.play();
      if (version === playbackVersion) say('Looping. Tap Stop to end playback.');
    } catch (error) {
      if (version === playbackVersion) { stopPlayback(); draw(); say(error.message); }
    }
  }
  function discard() {
    if (playing === 'draft') stopPlayback();
    if (draftUrl) URL.revokeObjectURL(draftUrl);
    draft = null;
    draftUrl = '';
    el('loopName').value = '';
    el('loopInputLevel').textContent = '';
    draw();
  }
  function prepareTake(chunks, size) {
    const bytes = new Uint8Array(size - size % 2);
    let offset = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, bytes.length - offset);
      bytes.set(part, offset);
      offset += part.length;
    }
    const pcm = new DataView(bytes.buffer);
    const samples = bytes.length / 2;
    let peak = 0;
    for (let index = 0; index < samples; index++)
      peak = Math.max(peak, Math.abs(pcm.getInt16(index * 2, true)));

    // Fade only the edges (5 ms at 16 kHz) to avoid a click at the loop seam.
    const fade = Math.min(80, Math.floor(samples / 2));
    for (let index = 0; index < fade; index++) {
      for (const position of [index, samples - 1 - index]) {
        const byte = position * 2;
        pcm.setInt16(byte, Math.round(pcm.getInt16(byte, true) * index / fade), true);
      }
    }
    el('loopInputLevel').textContent = peak >= 32760
      ? 'Input hit maximum level. Lower the microphone input level or move it farther away.'
      : `Input peak · ${Math.round(peak * 100 / 32768)}%`;
    return PiMicrophone.wave([bytes], bytes.length);
  }

  function stopRecording({keep = true, reason = ''} = {}) {
    const current = capture;
    if (!current) return;
    capture = null;
    current.controller.abort();
    if (keep && current.bytes >= 2) {
      draft = prepareTake(current.chunks, current.bytes);
      draftUrl = URL.createObjectURL(draft);
      say(reason || 'Take ready. Preview it or give it a name and save.');
    } else say(reason || 'No audio recorded.');
    controls();
  }
  async function toggleRecording() {
    if (capture) { stopRecording(); return; }
    if (busy || draft || !available || !device.value || document.hidden) return;
    stopPlayback();
    const current = {controller: new AbortController(), chunks: [], bytes: 0};
    capture = current;
    draw();
    say('Connecting to the Pi microphone…');
    try {
      const response = await fetch('/api/chord-practice/record-loop', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({device: device.value}), signal: current.controller.signal
      });
      if (!response.ok) throw Error((await response.json().catch(() => ({}))).message || 'Could not start recording.');
      const reader = response.body.getReader();
      try {
        if (capture !== current) return;
        say('● Recording. Tap Stop when you finish.');
        while (capture === current) {
          const {value, done} = await reader.read();
          if (done || capture !== current) break;
          current.chunks.push(value);
          current.bytes += value.length;
        }
        if (capture === current) stopRecording({reason: current.bytes ? 'Recording limit reached. Your take is ready.' : 'No audio recorded.'});
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (capture === current) stopRecording({reason: error.message + (current.bytes ? ' Partial take is available.' : '')});
    }
  }

  el('recordLoop').onclick = toggleRecording;
  // A future pedal adapter can send this event through the same record/stop action.
  document.addEventListener('guitar-looper-toggle', toggleRecording);
  el('loopDevice').onchange = () => { PiMicrophone.remember(device.value); controls(); };
  el('loopName').oninput = controls;
  el('previewLoop').onclick = () => playLoop('draft', draftUrl);
  el('discardLoop').onclick = () => { discard(); say('Take discarded.'); };
  el('saveLoop').onclick = async () => {
    const name = el('loopName').value.trim();
    if (!draft || !name || busy) return;
    busy = true;
    controls();
    try {
      const saved = await request('?name=' + encodeURIComponent(name), {
        method: 'POST', headers: {'Content-Type': 'audio/wav'}, body: draft
      });
      loops.unshift(saved);
      discard();
      say('Saved on the Pi.');
    } catch (error) { say(error.message); }
    finally { busy = false; draw(); }
  };
  el('removeLoopDialog').addEventListener('close', async () => {
    const loop = pendingDelete;
    pendingDelete = null;
    if (!loop || el('removeLoopDialog').returnValue !== 'remove') return;
    busy = true;
    if (playing === loop.id) stopPlayback();
    draw();
    try {
      await request('/' + loop.id, {method: 'DELETE'});
      loops = loops.filter(item => item.id !== loop.id);
      say('Loop deleted.');
    } catch (error) { say(error.message); }
    finally { busy = false; draw(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && capture) stopRecording({reason: 'Recording stopped while away. Your take is ready.'});
  });
  window.addEventListener('pagehide', () => {
    stopRecording({keep: false});
    stopPlayback();
    discard();
  });
  draw();
  request().then(items => { loops = items; draw(); }).catch(error => say(error.message));
  PiMicrophone.load(device).then(result => {
    available = result.available;
    say(!available ? result.message : result.missing ? 'Choose a microphone.' : 'Ready · takes can be up to 10 minutes.');
    controls();
  }).catch(error => say(error.message));
})();
