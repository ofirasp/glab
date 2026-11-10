(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const timing = new URLSearchParams(location.search).get('mode') === 'timing';
  const tuning = () => PiMicrophone.guitarTunings[el('tuning').value].notes;
  const stringName = index => 'String ' + (6 - index);
  const say = text => { el('message').textContent = text; };
  let shapes = [], shapeIndex = 0, targets = [], step = 0, available = false, capture = null;
  let context, clicks = [], clock;
  const beats = Array.from({length: 32}, (_, index) => {
    const cell = document.createElement('span');
    cell.className = 'beat';
    cell.textContent = String(index % 4 + 1);
    el('beatGrid').append(cell);
    return cell;
  });

  el('title').textContent = timing ? 'Strumming Timing' : 'Chord Clean Check';
  el('cleanPanel').hidden = el('chordLabel').hidden = el('tuningLabel').hidden = el('capoLabel').hidden = timing;
  el('timingPanel').hidden = el('tempoLabel').hidden = el('beatModeLabel').hidden = !timing;
  el('instruction').textContent = timing ? 'Follow the visual beat. Use headphones if you enable clicks.' : 'Fret numbers are relative to the capo.';

  function controls() {
    el('start').disabled = !capture && (!available || !el('device').value || (!timing && !targets.length));
    el('start').textContent = capture ? 'Stop' : 'Start';
    for (const id of ['device', 'chord', 'tuning', 'capo', 'tempo', 'beatMode']) el(id).disabled = Boolean(capture);
    el('previousShape').disabled = el('nextShape').disabled = Boolean(capture) || shapes.length < 2;
  }

  function stop() {
    capture?.abort();
    capture = null;
    clearInterval(clock);
    el('beatPulse').hidden = true;
    for (const click of clicks) click.stop();
    clicks = [];
    controls();
  }

  async function devices() {
    try {
      const result = await PiMicrophone.load(el('device'));
      available = result.available;
      say(result.missing ? 'Choose a microphone.' : !available ? result.message : timing
        ? 'Tap Start for a four-beat count-in. Then strum once per beat.'
        : 'Choose a shape, tap Start, then pluck each shown string.');
    } catch (error) { say(error.message); }
    controls();
  }
  el('device').onchange = () => { PiMicrophone.remember(el('device').value); controls(); };

  function showStrings() {
    const frets = shapes[shapeIndex]?.frets ?? [];
    el('cleanStrings').replaceChildren(...frets.map((fret, index) => {
      const cell = document.createElement('div');
      const targetIndex = targets.findIndex(target => target.index === index);
      const state = fret < 0 ? 'muted' : targetIndex < step ? 'correct' : targetIndex === step ? 'current' : '';
      cell.className = 'string ' + state;
      cell.textContent = stringName(index) + ' · ' + (fret < 0 ? 'Skip' : PiMicrophone.noteName(targets[targetIndex].midi))
        + (state === 'correct' ? ' ✓' : '');
      return cell;
    }));
  }

  function showShape() {
    const shape = shapes[shapeIndex];
    step = 0;
    const openStrings = tuning(), capo = Number(el('capo').value);
    targets = shape?.frets.flatMap((fret, index) => fret < 0 ? [] : [{index, midi: openStrings[index] + capo + fret}]) ?? [];
    const labels = openStrings.map(midi => PiMicrophone.noteName(midi).slice(0,-1));
    el('cleanDiagram').replaceChildren(shape ? GuitarChordDiagram(shape, el('chord').value, labels) : 'No shape available in this tuning.');
    el('shapeCount').textContent = shapes.length ? `${shapeIndex + 1} / ${shapes.length}` : '—';
    showStrings();
    controls();
  }

  if (!timing) {
    for (const root of ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']) {
      const group = document.createElement('optgroup');
      group.label = root;
      for (const suffix of ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'add9', 'dim', 'aug'])
        group.append(new Option(root + suffix, root + suffix));
      el('chord').append(group);
    }
    for (let fret = 0; fret <= 12; fret++) el('capo').append(new Option(fret ? 'Fret ' + fret : 'No capo', fret));
    el('chord').value = 'G';
    function loadShapes() {
      shapes = GuitarChords.shapes(el('chord').value, tuning().map(midi => midi % 12));
      shapeIndex = 0;
      showShape();
    }
    el('chord').onchange = el('tuning').onchange = loadShapes;
    el('capo').onchange = showShape;
    for (const [id, direction] of [['previousShape', -1], ['nextShape', 1]]) {
      el(id).onclick = () => {
        shapeIndex = (shapeIndex + direction + shapes.length) % shapes.length;
        showShape();
      };
    }
    loadShapes();
  }

  function nextString() {
    const {index, midi} = targets[step];
    say(`Pluck ${stringName(index)} · listen for ${PiMicrophone.noteName(midi)}.`);
  }

  async function clean(controller) {
    step = 0;
    showStrings();
    nextString();
    let lastNote = null, consecutive = 0, previous = null;
    await PiMicrophone.listen(el('device').value, controller.signal, frequency => {
      if (controller.signal.aborted) return;
      const note = frequency ? Math.round(PiMicrophone.midi(frequency)) : null;
      if (note === null) { lastNote = previous = null; consecutive = 0; return; }
      consecutive = note === lastNote ? consecutive + 1 : 1;
      lastNote = note;
      if (consecutive < 2 || note === previous) return;
      const target = targets[step];
      if (note !== target.midi) {
        say(`Heard ${PiMicrophone.noteName(note)} · try ${stringName(target.index)} (${PiMicrophone.noteName(target.midi)}).`);
        return;
      }
      previous = note;
      step++;
      showStrings();
      if (step === targets.length) { stop(); say(`All ${step} expected notes matched.`); }
      else nextString();
    });
  }

  function clickAt(time, accent) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = accent ? 2400 : 1800;
    gain.gain.setValueAtTime(.001, time);
    gain.gain.linearRampToValueAtTime(.11, time + .005);
    gain.gain.exponentialRampToValueAtTime(.001, time + .045);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + .05);
    clicks.push(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function showTiming(hits, extra) {
    const counts = {early: 0, late: 0, 'on-time': 0, missed: 0};
    for (const [index, beat] of beats.entries()) {
      const offset = hits[index];
      const label = offset === null ? 'missed' : offset < -.08 ? 'early' : offset > .08 ? 'late' : 'on-time';
      counts[label]++;
      beat.className = 'beat ' + label;
      beat.textContent = offset === null ? 'Missed' : `${offset > 0 ? '+' : ''}${Math.round(offset * 1000)} ms`;
    }
    el('timingResult').textContent = `${counts['on-time']} on beat · ${counts.early} early · ${counts.late} late · ${counts.missed} missed`;
    say(`Approximate timing · negative = early · positive = late${extra ? ' · '+extra+' extra strums' : ''}.`);
  }

  async function strum(controller) {
    const period = 60 / Number(el('tempo').value);
    const hits = Array(32).fill(null);
    const audible = el('beatMode').value === 'audio';
    let low = 0, guitarBand = 0, broadbandEnergy = 0;
    let extra = 0, anchor, firstBeat, samples = 0, lowByte = null, energy = 0, envelope = 0, last = -Infinity;
    beats.forEach((beat, index) => { beat.className = 'beat'; beat.textContent = String(index % 4 + 1); });
    el('timingResult').textContent = 'One strum per beat · 8 bars';
    say('Connecting to the microphone…');
    const response = await fetch('/api/chord-practice/record', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device: el('device').value}), signal: controller.signal
    });
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).message || 'Could not start the microphone.');
    const reader = response.body.getReader();
    try {
      while (!controller.signal.aborted) {
        const {done, value} = await reader.read();
        if (controller.signal.aborted) return;
        if (done) throw Error('Microphone audio stopped before the exercise finished.');
        if (anchor === undefined) {
          anchor = context.currentTime - value.length / 32000;
          const countIn = context.currentTime + .18;
          firstBeat = countIn + 4 * period;
          if (audible) for (let index = 0; index < 36; index++) clickAt(countIn + index * period, index % 4 === 0);
          const pulse = el('beatPulse');
          pulse.hidden = false;
          say('Count in · 1, 2, 3, 4');
          let shownBeat = -5;
          clock = setInterval(() => {
            if (capture !== controller) return;
            const index = Math.floor((context.currentTime - firstBeat) / period);
            if (index >= 32) {
              stop();
              showTiming(hits, extra);
            } else if (index >= -4 && index !== shownBeat) {
              shownBeat = index;
              const beat = (index + 4) % 4 + 1;
              pulse.textContent = index < 0 ? `Count-in · ${beat}` : `Bar ${Math.floor(index / 4) + 1} · Beat ${beat}`;
            }
          }, 40);
        }
        for (const byte of value) {
          if (lowByte === null) { lowByte = byte; continue; }
          const sample = (lowByte | (byte << 8)) << 16 >> 16;
          lowByte = null;
          // The audible clicks are above the guitar band. Reject attacks dominated by those frequencies.
          const input = sample / 32768;
          low += .18 * (input - low);
          guitarBand += .18 * (low - guitarBand);
          energy += guitarBand * guitarBand;
          broadbandEnergy += input * input;
          if (++samples % 160) continue;
          const rms = Math.sqrt(energy / 160);
          const hasGuitarBand = energy >= broadbandEnergy * .12;
          energy = broadbandEnergy = 0;
          const time = anchor + (samples - 80) / 16000;
          const onset = hasGuitarBand && rms > Math.max(.008, envelope * 2.2);
          envelope = envelope * .85 + rms * .15;
          if (time < firstBeat - period * .45 || !onset || time - last < .12) continue;
          last = time;
          const beat = Math.round((time - firstBeat) / period);
          if (beat < 0 || beat >= hits.length) continue;
          const offset = time - firstBeat - beat * period;
          if (Math.abs(offset) > period * .45 || hits[beat] !== null) { extra++; continue; }
          hits[beat] = offset;
          beats[beat].className = 'beat current';
          beats[beat].textContent = '✓';
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  }

  el('start').onclick = async () => {
    if (capture) { stop(); say('Stopped. Tap Start to try again.'); return; }
    const controller = new AbortController();
    capture = controller;
    controls();
    try {
      if (timing) {
        context ??= new AudioContext();
        await context.resume();
        if (!controller.signal.aborted) await strum(controller);
      } else await clean(controller);
    } catch (error) {
      if (!controller.signal.aborted) { stop(); say(error.message); }
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && capture) { stop(); say('Paused. Tap Start to try again.'); }
  });
  window.addEventListener('pagehide', stop);
  devices();
})();
