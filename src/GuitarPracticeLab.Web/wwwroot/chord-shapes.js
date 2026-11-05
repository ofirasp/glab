/* Standard tuning only. Every displayed voicing is checked against its pitch set.
   No external chord service, image download or third-party chord database. */
(function (scope) {
  'use strict';
  const tuning = [4, 9, 2, 7, 11, 4]; // low E to high e
  const roots = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const qualities = {
    '': [0,4,7], m:[0,3,7], '5':[0,7], '7':[0,4,7,10], maj7:[0,4,7,11],
    m7:[0,3,7,10], sus2:[0,2,7], sus4:[0,5,7], dim:[0,3,6], aug:[0,4,8],
    dim7:[0,3,6,9], m7b5:[0,3,6,10], '6':[0,4,7,9], m6:[0,3,7,9],
    '6add9':[0,2,4,7,9], add9:[0,2,4,7], madd9:[0,2,3,7], '9':[0,2,4,7,10], m9:[0,2,3,7,10],
    maj9:[0,2,4,7,11], '7sus4':[0,5,7,10], '7sus2':[0,2,7,10],
    '7b5':[0,4,6,10], '7#5':[0,4,8,10], '7b9':[0,1,4,7,10], '7#9':[0,3,4,7,10]
  };
  const open = {
    C:[-1,3,2,0,1,0], D:[-1,-1,0,2,3,2], E:[0,2,2,1,0,0], F:[1,3,3,2,1,1],
    G:[3,2,0,0,0,3], A:[-1,0,2,2,2,0], B:[-1,2,4,4,4,2],
    Am:[-1,0,2,2,1,0], Dm:[-1,-1,0,2,3,1], Em:[0,2,2,0,0,0],
    C7:[-1,3,2,3,1,0], D7:[-1,-1,0,2,1,2], E7:[0,2,0,1,0,0], G7:[3,2,0,0,0,1], A7:[-1,0,2,0,2,0],
    Cmaj7:[-1,3,2,0,0,0], Dmaj7:[-1,-1,0,2,2,2], Emaj7:[0,2,1,1,0,0], Amaj7:[-1,0,2,1,2,0],
    Am7:[-1,0,2,0,1,0], Dm7:[-1,-1,0,2,1,1], Em7:[0,2,0,0,0,0],
    Dsus2:[-1,-1,0,2,3,0], Dsus4:[-1,-1,0,2,3,3], Asus2:[-1,0,2,2,0,0], Asus4:[-1,0,2,2,3,0]
  };
  function parse(name) {
    const match = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(name.replaceAll('♯','#').replaceAll('♭','b'));
    if (!match) return null;
    const pitch = (letter, accidental) => (roots[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
    let quality = match[3].replace(/^min/, 'm').replace(/^M/, 'maj').replace(/^°/, 'dim').replace(/^ø7$/, 'm7b5');
    if (!(quality in qualities)) return null;
    const root = pitch(match[1], match[2]);
    const bass = match[4] ? pitch(match[4], match[5]) : root;
    const notes = qualities[quality].map(n => (n + root) % 12);
    if (!notes.includes(bass)) notes.push(bass);
    return { root, bass, quality, notes };
  }
  function valid(frets, chord) {
    const sounded = frets.flatMap((f, i) => f < 0 ? [] : [(tuning[i] + f) % 12]);
    return sounded.length >= 3 && sounded[0] === chord.bass && sounded.every(n => chord.notes.includes(n)) && chord.notes.every(n => sounded.includes(n));
  }
  function fingers(frets) {
    const used = frets.filter(f => f > 0), min = Math.min(...used), max = Math.max(...used);
    if (!used.length || max - min > 3) return null;
    const atBase = frets.flatMap((f,i) => f === min ? [i] : []);
    let barre = null;
    if (atBase.length >= 2 && frets.slice(atBase[0], atBase.at(-1) + 1).every(f => f >= min)) barre = { fret: min, from: atBase[0], to: atBase.at(-1) };
    const order = frets.flatMap((f,i) => f > 0 && !(barre && f === min && i >= barre.from && i <= barre.to) ? [{ f, i }] : []).sort((a,b) => a.f - b.f || a.i - b.i);
    if (order.length + (barre ? 1 : 0) > 4) return null;
    const labels = Array(6).fill(null);
    if (barre) atBase.forEach(i => labels[i] = 1);
    order.forEach((v,i) => labels[v.i] = i + (barre ? 2 : 1));
    return { labels, barre };
  }
  const cache = new Map();
  function shapes(name) {
    if (cache.has(name)) return cache.get(name);
    const chord = parse(name);
    if (!chord) return [];
    const result = [], seen = new Set();
    function add(frets, preferred = false) {
      if (!valid(frets, chord)) return;
      const fingering = fingers(frets);
      if (!fingering) return;
      const key = frets.join(','); if (seen.has(key)) return; seen.add(key);
      const positive = frets.filter(f => f > 0), min = Math.min(...positive), max = Math.max(...positive);
      const score = (preferred ? -100 : 0) + max * 2 + (max - min) * 3 + frets.filter(f => f < 0).length * 2 + (fingering.barre ? 5 : 0);
      result.push({ frets: [...frets], ...fingering, score });
    }
    if (open[name]) add(open[name], true);
    // Generate compact voicings up to fret 12, with all chord tones and requested bass.
    for (let start = 0; start <= 9; start++) {
      const choices = tuning.map(n => [-1, ...Array.from({length:4}, (_,i) => start + i).filter(f => chord.notes.includes((n + f) % 12))]);
      function walk(frets, first) {
        const i = frets.length;
        if (i === 6) { add(frets); return; }
        for (const fret of choices[i]) {
          if (first && fret >= 0 && (tuning[i] + fret) % 12 !== chord.bass) continue;
          walk([...frets, fret], first && fret < 0);
        }
      }
      walk([], true);
    }
    result.sort((a,b) => a.score - b.score);
    const selected = result.slice(0, 12);
    cache.set(name, selected);
    return selected;
  }
  scope.GuitarChords = { parse, shapes, valid, tuning };
})(typeof window === 'undefined' ? globalThis : window);
