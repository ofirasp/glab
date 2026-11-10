(() => {
  'use strict';
  const key = 'guitar-pi-microphone';
  const api = '/api/chord-practice';
  const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  const guitarTunings = {
    standard: {label: 'Standard', notes: [40,45,50,55,59,64]},
    dropD: {label: 'Drop D', notes: [38,45,50,55,59,64]},
    halfDown: {label: 'Half step down', notes: [39,44,49,54,58,63]},
    wholeDown: {label: 'Whole step down', notes: [38,43,48,53,57,62]},
    dadgad: {label: 'DADGAD', notes: [38,45,50,55,57,62]},
    openG: {label: 'Open G', notes: [38,43,50,55,59,62]}
  };

  function remember(device) {
    try { localStorage.setItem(key, device); } catch {}
  }

  async function load(select) {
    const response = await fetch(api + '/devices', {cache: 'no-store', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Could not read the Pi microphone list.');
    const result = await response.json();
    select.replaceChildren(...result.devices.map(name => new Option(name, name)));
    let preferred;
    try { preferred = localStorage.getItem(key); } catch {}
    const missing = Boolean(preferred && !result.devices.includes(preferred));
    if (missing) select.selectedIndex = -1;
    else if (preferred) select.value = preferred;
    return {...result, missing};
  }

  async function stream(path, body, signal, receive) {
    const response = await fetch(api + path, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Error(error.message || 'Could not start the Pi microphone.');
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      let pending = '';
      while (!signal.aborted) {
        const {done, value} = await reader.read();
        if (done) break;
        const lines = (pending + value).split('\n');
        pending = lines.pop();
        for (const line of lines) {
          const sample = JSON.parse(line);
          if (sample.error) throw Error(sample.error);
          receive(sample);
        }
      }
      if (!signal.aborted) throw Error('The microphone stopped listening.');
    } finally { await reader.cancel().catch(() => {}); }
  }

  function listen(device, signal, receive) {
    return stream('/listen', {device}, signal, sample => receive(sample.frequency));
  }
  function listenChords(device, names, shift, signal, receive) {
    return stream('/listen-chords', {device, names, shift}, signal, sample => receive(sample.chord));
  }

  function wave(chunks, size) {
    const rate = 16000, bytesPerSecond = rate * 2;
    const header = new DataView(new ArrayBuffer(44));
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']])
      for (let index = 0; index < text.length; index++) header.setUint8(offset + index, text.charCodeAt(index));
    header.setUint32(4, size + 36, true);
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, rate, true);
    header.setUint32(28, bytesPerSecond, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    header.setUint32(40, size, true);
    return new Blob([header.buffer, ...chunks], {type: 'audio/wav'});
  }

  function midi(frequency) { return 69 + 12 * Math.log2(frequency / 440); }
  function noteName(note) { return noteNames[(note % 12 + 12) % 12] + (Math.floor(note / 12) - 1); }

  window.PiMicrophone = {load, remember, listen, listenChords, wave, midi, noteName, guitarTunings};
})();
