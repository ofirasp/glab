(() => {
  'use strict';
  const device = $('tunerDevice'), autoButton = $('tunerAuto');
  let capture = null, automatic = true, deviceRequest = 0, available = false;

  let confirmedString = null, candidate = null, stable = 0, misses = 0, chimeUntil = 0;

  // Keep a real steady hold, but tolerate a short dropout or one noisy frame
  // as a plucked string decays. Confirm from a recent window, not all-time extrema.
  const holdMilliseconds = 500, windowMilliseconds = 1600, maxReadingGap = 1100;
  let autoCandidate = -1, autoSince = 0, autoFrames = 0;
  let lastReading = -Infinity, pitchReadings = [], displayReadings = [], displayString = -1, displayedAt = -Infinity;

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
    updateGuitarInTune();
  }

  function updateGuitarInTune() {
    $('guitarInTune').hidden = ![...$('strings').children].every(button => button.classList.contains('string-in-tune'));
  }

  function resetConfirmation() {
    confirmedString = candidate = null;
    stable = misses = chimeUntil = 0;
    pitchReadings = []; displayReadings = []; displayString = -1;
    autoCandidate = -1; autoFrames = 0;
    $('needle').classList.add('waiting');
    $('tuning').dataset.direction = 'waiting';
    lastReading = -Infinity;
    if ($('tuning').classList.contains('in-tune')) $('tuning').textContent = 'Pluck one string at a time';
    $('tuning').classList.remove('in-tune');
  }

  function confirm(inTune, offset = null) {
    const now = performance.now();
    if (offset === null) {
      misses++;
      if (now-lastReading > maxReadingGap) {
        candidate = confirmedString = null;
        stable = 0; pitchReadings = []; lastReading = -Infinity;
      }
      return false;
    }
    misses = 0;
    if (candidate !== selected || now-lastReading > maxReadingGap || Math.abs(offset) > 12) {
      pitchReadings = []; stable = 0;
    }
    candidate = selected;
    // Buffered network frames cannot substitute for elapsed listening time.
    if (now-lastReading < 100) return false;
    lastReading = now;
    pitchReadings = pitchReadings.filter(reading => now-reading.time <= windowMilliseconds);
    pitchReadings.push({time:now, offset});
    const good = pitchReadings.filter(reading => Math.abs(reading.offset) <= 5);
    stable = good.length;
    if (!inTune || stable < 3 || stable/pitchReadings.length < .8
      || now-good[0].time < holdMilliseconds) return false;
    const offsets = good.map(reading => reading.offset).sort((a,b)=>a-b);
    // Ignore the two extreme readings, while rejecting a genuinely wavering note.
    const trim = offsets.length >= 5 ? 1 : 0;
    if (offsets[offsets.length-1-trim]-offsets[trim] > 6) return false;
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

  function showLocked(heard) {
    $('note').textContent = names[selected];
    $('freq').textContent = freqs[selected].toFixed(2) + ' Hz · target';
    $('needle').style.left = '50%';$('needle').classList.remove('waiting');
    $('tuning').textContent = '✓ In tune · Tap string to retune';
    $('tuning').dataset.direction = 'locked';$('tuning').classList.add('in-tune');
    $('tunerLastScore').textContent = 'Confirmed · ' + names[selected] + ' · 100%';
    $('tunerScoreMeter').value = 100;$('tunerScoreMeter').hidden = false;
    highlightString(heard);
  }
  function reading(frequency) {
    if (toneOsc || performance.now() < chimeUntil) return;
    const now = performance.now();
    const locked = () => $('strings').children[selected].classList.contains('string-in-tune');
    if (!frequency || !Number.isFinite(frequency)) {
      confirm(false);
      highlightString(-1);
      if (locked()) {showLocked(-1);return;}
      $('tuning').classList.remove('in-tune');
      $('needle').classList.add('waiting');
      $('freq').textContent = 'Note faded · pluck again';
      $('tuning').textContent = 'Pluck string ' + (6-selected) + ' (' + names[selected] + ')';
      $('tuning').dataset.direction = 'waiting';
      return;
    }
    const heard = freqs.reduce((closest, reference, index) =>
      Math.abs(Math.log2(frequency / reference)) < Math.abs(Math.log2(frequency / freqs[closest]))
        ? index : closest, selected);
    const heardOffset = 1200 * Math.log2(frequency / freqs[heard]);
    if (automatic) {
      // Do not jump to an already-green string on a single noise/harmonic frame.
      if (Math.abs(heardOffset)>150) {
        $('needle').classList.add('waiting');
        $('freq').textContent = 'Unclear pitch · pluck one string';
        $('tuning').textContent = 'Tap a string circle to tune it manually';
        $('tuning').classList.remove('in-tune');$('tuning').dataset.direction='waiting';
        autoCandidate = -1;autoFrames = 0;return;
      }
      if (heard !== selected) {
        if (autoCandidate !== heard || now-autoSince > 650) {autoCandidate=heard;autoFrames=1;autoSince=now;}
        else if (now-autoSince>=100) {autoFrames++;}
        if (autoFrames<2) {
          $('needle').classList.add('waiting');$('freq').textContent='Checking '+names[heard]+'…';
          $('tuning').classList.remove('in-tune');$('tuning').dataset.direction='waiting';
          $('tuning').textContent='Keep that string ringing…';return;
        }
        selected = heard;
        // Reset this string's measurement window without altering saved green strings.
        candidate = null;pitchReadings=[];displayReadings=[];lastReading=-Infinity;
      }
      autoCandidate=-1;autoFrames=0;
    }
    if (locked()) {showLocked(heard);return;}
    const rawOffset = 1200 * Math.log2(frequency / freqs[selected]);
    if (displayString !== selected || now-displayedAt > 650) displayReadings = [];
    displayString = selected; displayedAt = now;
    displayReadings.push(rawOffset);displayReadings = displayReadings.slice(-3);
    const sorted = [...displayReadings].sort((a,b)=>a-b);
    const offset = sorted[Math.floor(sorted.length/2)];
    const shownFrequency = freqs[selected] * 2 ** (offset/1200);
    const measured = PiMicrophone.noteName(Math.round(PiMicrophone.midi(shownFrequency)));
    $('note').textContent = names[selected];
    $('freq').textContent = shownFrequency.toFixed(2) + ' Hz · Heard ' + measured;
    $('needle').classList.remove('waiting');
    $('needle').style.left = (50 + Math.max(-45, Math.min(45, offset))) + '%';
    const inTune = Math.abs(rawOffset) <= 5;
    const confirmed = confirm(inTune, rawOffset);
    $('tuning').classList.toggle('in-tune', confirmed);
    const centered = Math.abs(offset) <= 5;
    $('tuning').dataset.direction = confirmed ? 'locked' : centered ? 'center' : offset < 0 ? 'tighten' : 'loosen';
    $('tuning').textContent = confirmed ? '✓ In tune' : centered ? 'Centered · checking…'
      : offset < 0 ? `Tighten string ${6-selected} → · ${Math.abs(offset).toFixed(0)} cents flat`
      : `← Loosen string ${6-selected} · ${Math.abs(offset).toFixed(0)} cents sharp`;
    highlightString(heard);
    saveStringResult(heard, inTune, confirmed);
    const score = Math.round(100 * Math.max(0, Math.min(1, (50 - Math.abs(offset)) / 45)));
    $('tunerLastScore').textContent = `${confirmed ? 'Confirmed' : 'Pitch closeness'} · ${names[selected]} · ${score}%`;
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
    const button = $('strings').children[selected];
    button.classList.remove('string-in-tune', 'string-out-of-tune');
    button.removeAttribute('title');
    highlightString(-1);
    updateGuitarInTune();
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
  document.addEventListener('guitar-page-change', () => {
    if (currentPage === 'tuner') {
      automatic = true;
      autoButton.setAttribute('aria-pressed', 'true');
      autoButton.textContent = 'Auto string';
      tuningMenu.value = 'standard';
      tuningMenu.onchange();
    }
    void show();
  });
  document.addEventListener('guitar-exercise-open', stop);
  document.addEventListener('visibilitychange', show);
  window.addEventListener('pagehide', stop);
  show();
})();
