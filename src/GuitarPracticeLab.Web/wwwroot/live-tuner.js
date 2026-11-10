(() => {
  'use strict';
  const device = $('tunerDevice'), autoButton = $('tunerAuto');
  let capture = null, automatic = true, deviceRequest = 0, available = false;

  let confirmedString = null, candidate = null, stable = 0, misses = 0, chimeUntil = 0;

  function highlightString(heard) {
    [...$('strings').children].forEach((item, index) => {
      item.classList.toggle('active', index === selected);
      item.classList.toggle('heard', index === heard);
    });
  }

  function saveStringResult(heard, inTune, confirmed) {
    if (heard !== selected || (inTune && !confirmed)) return;
    const buttons = $('strings').children;
    buttons[heard].classList.toggle('string-in-tune', inTune);
    buttons[heard].classList.toggle('string-out-of-tune', !inTune);
    buttons[heard].title = inTune ? 'In tune' : 'Needs tuning';
    $('guitarInTune').hidden = ![...buttons].every(button => button.classList.contains('string-in-tune'));
  }

  function resetConfirmation() {
    confirmedString = candidate = null;
    stable = misses = chimeUntil = 0;
    if ($('tuning').classList.contains('in-tune')) $('tuning').textContent = 'Pluck one string at a time';
    $('tuning').classList.remove('in-tune');
  }

  function confirm(inTune) {
    if (!inTune) {
      candidate = null;
      stable = 0;
      if (++misses >= 2) confirmedString = null;
      return false;
    }
    misses = 0;
    stable = candidate === selected ? stable + 1 : 1;
    candidate = selected;
    if (stable < 2) return false;
    if (confirmedString !== selected) {
      confirmedString = selected;
      if (ctx?.state === 'running') {
        const start = ctx.currentTime + .01;
        sound(880, start, .09, .10);
        sound(1174.66, start + .095, .15, .10);
        chimeUntil = performance.now() + 360;
      }
    }
    return true;
  }

  function stop() {
    capture?.abort();
    capture = null;
    resetConfirmation();
    highlightString(-1);
  }

  async function show() {
    const version = ++deviceRequest;
    if (currentPage !== 'tuner' || document.hidden) { stop(); return; }
    device.disabled = true;
    try {
      const result = await PiMicrophone.load(device);
      if (version !== deviceRequest) return;
      available = result.available;
      device.disabled = false;
      $('status').textContent = result.missing ? 'Saved microphone unavailable. Choose another device.'
        : result.available ? 'Connecting to the Pi microphone…' : result.message;
      start();
    } catch (error) {
      if (version === deviceRequest) { device.disabled = false; $('status').textContent = error.message; }
    }
  }

  function reading(frequency) {
    if (toneOsc || performance.now() < chimeUntil) return;
    if (!frequency) {
      confirm(false);
      highlightString(-1);
      $('tuning').classList.remove('in-tune');
      $('freq').textContent = 'Waiting for a clear note…';
      $('tuning').textContent = 'Pluck one string at a time';
      $('needle').style.left = '50%';
      return;
    }
    const heard = freqs.reduce((closest, reference, index) =>
      Math.abs(Math.log2(frequency / reference)) < Math.abs(Math.log2(frequency / freqs[closest]))
        ? index : closest, selected);
    if (automatic) selected = heard;
    const offset = 1200 * Math.log2(frequency / freqs[selected]);
    const measured = PiMicrophone.noteName(Math.round(PiMicrophone.midi(frequency)));
    $('note').textContent = names[selected];
    $('freq').textContent = frequency.toFixed(2) + ' Hz · Heard ' + measured;
    $('needle').style.left = (50 + Math.max(-45, Math.min(45, offset))) + '%';
    const inTune = Math.abs(offset) <= 5;
    const confirmed = confirm(inTune);
    $('tuning').classList.toggle('in-tune', confirmed);
    $('tuning').textContent = confirmed ? '✓ In tune' : inTune ? 'Hold the note…'
      : `${offset < 0 ? 'Flat · tune up ↑' : 'Sharp · tune down ↓'} (${offset.toFixed(0)} cents)`;
    highlightString(heard);
    saveStringResult(heard, inTune, confirmed);
    const score = Math.round(100 * Math.max(0, Math.min(1, (50 - Math.abs(offset)) / 45)));
    $('tunerLastScore').textContent = `Last string · ${names[selected]} · ${score}%`;
    $('tunerScoreMeter').value = score;
    $('tunerScoreMeter').hidden = false;
  }

  const tuningMenu = $('tunerTuning');
  for (const [key, tuning] of Object.entries(PiMicrophone.guitarTunings))
    tuningMenu.add(new Option(tuning.label, key));
  tuningMenu.value = 'standard';
  tuningMenu.onchange = () => {
    stopTone();
    resetConfirmation();
    const notes = PiMicrophone.guitarTunings[tuningMenu.value].notes;
    for (const [index, button] of [...$('strings').children].entries()) {
      names[index] = PiMicrophone.noteName(notes[index]);
      freqs[index] = 440 * 2 ** ((notes[index] - 69) / 12);
      button.textContent = names[index];
      button.removeAttribute('title');
      button.classList.remove('heard', 'string-in-tune', 'string-out-of-tune');
    }
    $('guitarInTune').hidden = true;
    $('tunerLastScore').textContent = 'Last string · —';
    $('tunerScoreMeter').hidden = true;
    update();
  };

  device.onchange = () => {
    PiMicrophone.remember(device.value);
    stop();
    const version = ++deviceRequest;
    setTimeout(() => { if (version === deviceRequest) start(); }, 250);
  };
  document.addEventListener('pointerdown', () => {
    if (currentPage === 'tuner') void audio().catch(() => {});
  }, { passive: true });
  autoButton.onclick = () => {
    resetConfirmation();
    automatic = !automatic;
    autoButton.setAttribute('aria-pressed', String(automatic));
    autoButton.textContent = automatic ? 'Auto string' : 'Manual string';
  };
  document.addEventListener('guitar-tuner-string', () => {
    resetConfirmation();
    automatic = false;
    autoButton.setAttribute('aria-pressed', 'false');
    autoButton.textContent = 'Manual string';
  });

  async function start() {
    if (capture || !available || !device.value || currentPage !== 'tuner' || document.hidden) return;
    const controller = new AbortController();
    capture = controller;
    $('status').textContent = 'Listening on the Pi. Pluck one open string.';
    reading(null);
    try { await PiMicrophone.listen(device.value, controller.signal, reading); }
    catch (error) {
      if (!controller.signal.aborted) $('status').textContent = error.message;
    } finally { if (capture === controller) stop(); }
  }
  $('tunerTab').addEventListener('click', () => { void audio().catch(() => {}); });
  document.addEventListener('guitar-page-change', show);
  document.addEventListener('guitar-exercise-open', stop);
  document.addEventListener('visibilitychange', show);
  window.addEventListener('pagehide', stop);
  show();
})();
