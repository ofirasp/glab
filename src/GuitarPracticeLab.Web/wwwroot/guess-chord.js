(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const pools = {
    open: ['C','D','E','G','A','Am','Em','Dm'],
    sevenths: ['C','D','G','A','Am','Em','C7','D7','E7','G7','A7','Am7','Em7'],
    barre: ['C','D','G','A','Am','Em','F','Bm','B','Fm','F#m','C#m']
  };
  const storage = 'guitar-guess-chord-progress';
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem(storage) || '{}') || {}; } catch {}
  let round = null, choices = [], answered = false, complete = false, target = '';
  let context, master, voices = [], playing = 0, resultTimer = null;
  function cancelResultTimer() {
    if (resultTimer !== null) {
      clearTimeout(resultTimer);resultTimer = null;
      el('nextGuess').disabled = el('guessLevel').disabled = false;
    }
  }
  const buffers = new Map();
  const say = value => { el('message').textContent = value; };
  function record(level) {
    const item = progress[level];
    return item && typeof item === 'object' ? item : {};
  }
  function refreshProgress() {
    const menu = el('guessLevel');
    menu.querySelector('[value="sevenths"]').disabled = !(record('open').best >= 8);
    menu.querySelector('[value="barre"]').disabled = !(record('sevenths').best >= 8);
    for (const key of ['sevenths','barre']) {
      const option = menu.querySelector('[value="' + key + '"]');
      option.textContent = (key === 'sevenths' ? 'Sevenths' : 'Barre chords') + (option.disabled ? ' · score 8/10 to unlock' : '');
    }
    const saved = record(menu.value);
    el('bestScore').textContent = saved.best === undefined ? 'No scores yet' : 'Last ' + saved.last + '/10 · Best ' + saved.best + '/10';
  }
  function stopSound() {
    playing++;
    for (const voice of voices) { try { voice.stop(); } catch {} }
    voices = [];
  }
  function pluck(midi) {
    if (buffers.has(midi)) return buffers.get(midi);
    const rate = context.sampleRate, frequency = 440 * 2 ** ((midi - 69) / 12);
    const length = Math.max(2, Math.round(rate / frequency - .5));
    const string = Float32Array.from({length}, () => Math.random() * 2 - 1);
    const buffer = context.createBuffer(1, rate * 2, rate), data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      const position = index % length;
      const value = string[position];
      string[position] = .497 * (value + string[(position + 1) % length]);
      data[index] = value * Math.min(1, index / (rate * .003)) * Math.min(1, (data.length - index) / (rate * .02));
    }
    buffers.set(midi, buffer);
    return buffer;
  }
  async function hear(name) {
    stopSound();
    const version = playing;
    try {
      context ??= new AudioContext();
      if (!master) { master = context.createGain(); master.connect(context.destination); }
      master.gain.value = Number(el('guessVolume').value) / 100;
      await context.resume();
      if (version !== playing || document.hidden) return;
      const shape = GuitarChords.shapes(name)[0];
      if (!shape) throw Error('No playable shape for ' + name);
      const tuning = [40,45,50,55,59,64];
      const strings = shape.frets.map((fret,index) => fret < 0 ? null : tuning[index] + fret).filter(note => note !== null);
      strings.forEach((note,index) => {
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = pluck(note);
        gain.gain.value = .8 / strings.length;
        source.connect(gain).connect(master);
        source.onended = () => { source.disconnect(); gain.disconnect(); voices = voices.filter(voice => voice !== source); };
        voices.push(source);
        source.start(context.currentTime + .02 + index * .035);
      });
    } catch (error) { say('Could not play the chord. ' + error.message + ' Tap Hear again to retry.'); }
  }
  function pickTarget(pool) {
    const mistakes = record(round.level).mistakes || {};
    const candidates = pool.filter(name => name !== target);
    const weights = candidates.map(name => 1 + Math.min(4, Number(mistakes[name]) || 0));
    let value = Math.random() * weights.reduce((sum,weight) => sum + weight,0);
    return candidates.find((name,index) => (value -= weights[index]) < 0) || candidates[0];
  }
  function shuffle(items) {
    for (let index = items.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }
  function question() {
    answered = complete = false;
    const pool = pools[round.level].filter(name => GuitarChords.shapes(name).length);
    target = pickTarget(pool);
    choices = shuffle([target, ...shuffle(pool.filter(name => name !== target)).slice(0,3)]);
    el('questionText').textContent = 'Which chord do you hear?';
    el('diagram').hidden = true;
    el('compareChoices').hidden = true;
    el('compareGuess').disabled = true;
    el('hearGuess').disabled = false;
    el('nextGuess').disabled = true;
    el('nextGuess').textContent = 'Next chord';
    el('guessLevel').disabled = true;
    el('roundProgress').textContent = 'Question ' + (round.answers + 1) + '/10 · Score ' + round.hits + ' · Streak ' + round.streak;
    el('answers').replaceChildren(...choices.map(name => {
      const button = document.createElement('button');
      button.textContent = name;
      button.onclick = () => answer(name);
      return button;
    }));
    say('Listen, then tap one answer. Hear again repeats the same chord.');
    void hear(target);
  }
  function saveRound() {
    const saved = record(round.level), mistakes = {...saved.mistakes};
    const confusions = {...saved.confusions};
    for (const [name,count] of Object.entries(round.mistakes)) mistakes[name] = (Number(mistakes[name]) || 0) + count;
    for (const [pair,count] of Object.entries(round.confusions)) confusions[pair] = (Number(confusions[pair]) || 0) + count;
    progress[round.level] = {
      best: Math.max(saved.best || 0, round.hits), last: round.hits,
      rounds: (saved.rounds || 0) + 1, mistakes, confusions
    };
    try { localStorage.setItem(storage, JSON.stringify(progress)); return true; }
    catch { return false; }
  }
  function celebrateRecord() {
    if (context?.state !== 'running' || !master || document.hidden) return;
    const start = context.currentTime + .03;
    for (const [notes,delay,duration,volume] of [
      [[392,523.25,659.25,783.99],0,.16,.045],
      [[523.25,659.25,783.99,1046.5],.23,.95,.055]
    ]) for (const note of notes) {
      const voice = context.createOscillator(), gain = context.createGain(), when = start + delay;
      voice.type = 'triangle';voice.frequency.value = note;
      gain.gain.setValueAtTime(0,when);
      gain.gain.linearRampToValueAtTime(volume,when+.005);
      gain.gain.exponentialRampToValueAtTime(.001,when+duration);
      voice.connect(gain).connect(master);voices.push(voice);
      voice.onended = () => {voice.disconnect();gain.disconnect();voices=voices.filter(item=>item!==voice);};
      voice.start(when);voice.stop(when+duration+.02);
    }
  }
  function showRoundResult(saved, previous, pairs) {
    stopSound();
    const best = saved && round.hits > 0 && (previous.best === undefined || round.hits > previous.best);
    const tied = saved && previous.best !== undefined && round.hits === previous.best;
    const level = {open:'Open chords',sevenths:'Sevenths',barre:'Barre chords'}[round.level];
    const dialog = el('changesRoundResult');dialog.classList.toggle('new-best',best);
    el('changesRoundIcon').textContent = best ? '★' : '✓';
    el('changesRoundTitle').textContent = best ? 'New personal best!' : tied ? 'Personal best matched!' : 'Round complete';
    el('changesRoundPair').textContent = level + ' · Best streak ' + round.longest;
    el('guessResultScore').textContent = round.hits + '/10';
    el('guessResultLast').textContent = previous.last === undefined ? '—' : previous.last + '/10';
    const difference = previous.last === undefined ? null : round.hits - previous.last;
    el('changesRoundDifference').textContent = difference === null ? 'First round' : difference === 0 ? 'Same as last' : (difference>0?'+':'') + difference + ' vs last';
    el('changesRoundDifference').classList.toggle('improved',difference>0);
    el('changesRoundBest').textContent = saved ? record(round.level).best + '/10' : previous.best === undefined ? '—' : previous.best + '/10';
    el('changesRoundPreviousBest').textContent = best ? previous.best === undefined ? 'First personal best' : 'Previous best: ' + previous.best + '/10' : tied ? 'You matched your best' : '';
    const unlocked = saved && round.hits >= 8 && !(previous.best >= 8) && round.level !== 'barre';
    const status = el('changesRoundSave');status.classList.toggle('save-error',!saved);
    status.textContent = (saved ? '✓ Progress saved in this browser.' : 'Could not save progress in this browser.')
      + (unlocked ? ' ' + (round.level === 'open' ? 'Sevenths' : 'Barre chords') + ' unlocked!' : '');
    status.title = status.textContent + (pairs.length ? ' Practise ' + pairs.join(', ') + '.' : '');
    dialog.showModal();
    if (best) celebrateRecord();
  }
  el('guessResultClose').onclick = el('guessResultReview').onclick = () => el('changesRoundResult').close();
  el('changesRoundAgain').onclick = () => {el('changesRoundResult').close();el('nextGuess').click();};
  function answer(name) {
    if (!round || answered || complete) return;
    answered = true;
    const right = name === target;
    round.answers++;
    round.streak = right ? round.streak + 1 : 0;
    round.longest = Math.max(round.longest, round.streak);
    if (right) round.hits++;
    else {
      round.mistakes[target] = (round.mistakes[target] || 0) + 1;
      const pair = target + ' mistaken for ' + name;
      round.confusions[pair] = (round.confusions[pair] || 0) + 1;
    }
    for (const button of el('answers').children) {
      button.disabled = true;
      button.classList.toggle('correct', button.textContent === target);
      button.classList.toggle('wrong', !right && button.textContent === name);
    }
    el('questionText').textContent = (right ? '✓ Correct · ' : 'The chord was ') + target;
    el('diagram').replaceChildren(GuitarChordDiagram(GuitarChords.shapes(target)[0], target));
    el('diagram').hidden = false;
    el('compareGuess').disabled = false;
    el('nextGuess').disabled = false;
    el('roundProgress').textContent = round.answers + '/10 answered · Score ' + round.hits + ' · Streak ' + round.streak;
    say(right ? 'Well heard. Compare the sounds or continue.' : 'You chose ' + name + '. Compare the sounds before continuing.');
    if (round.answers === 10) {
      complete = true;
      const previous = {...record(round.level)};
      const saved = saveRound();
      el('guessLevel').disabled = false;
      el('nextGuess').textContent = 'New round';
      el('roundProgress').textContent = 'Round complete · ' + round.hits * 10 + '% · Longest streak ' + round.longest;
      const pairs = Object.entries(round.confusions).sort((a,b) => b[1] - a[1]).slice(0,2).map(([pair,count]) => pair + ' (' + count + ')');
      refreshProgress();
      say((saved ? 'Progress saved in this browser.' : 'Could not save progress in this browser.') + (pairs.length ? ' Practise ' + pairs.join(', ') + '.' : ' All ten correct!'));
      cancelResultTimer();
      const finishedRound = round;
      el('nextGuess').disabled = el('guessLevel').disabled = true;
      resultTimer = setTimeout(() => {
        resultTimer = null;
        el('nextGuess').disabled = el('guessLevel').disabled = false;
        if (round === finishedRound && complete && !document.hidden) showRoundResult(saved, previous, pairs);
      }, 1500);
    }
  }
  el('nextGuess').onclick = () => {
    if (resultTimer !== null) return;
    cancelResultTimer();
    if (!round || complete) {
      round = {level:el('guessLevel').value,answers:0,hits:0,streak:0,longest:0,mistakes:{},confusions:{}};
    }
    question();
  };
  el('hearGuess').onclick = () => { if (target) void hear(target); };
  el('compareGuess').onclick = () => {
    el('compareChoices').hidden = !el('compareChoices').hidden;
    el('compareChoices').replaceChildren(...choices.map(name => {
      const button = document.createElement('button');
      button.textContent = 'Hear ' + name;
      button.onclick = () => { say('Playing ' + name); void hear(name); };
      return button;
    }));
  };
  el('guessVolume').oninput = () => { if (master) master.gain.value = Number(el('guessVolume').value) / 100; };
  el('guessLevel').onchange = () => {
    cancelResultTimer();
    stopSound();round = null;target = '';complete = false;
    el('answers').replaceChildren();el('compareChoices').hidden = true;el('diagram').hidden = true;
    el('hearGuess').disabled = el('compareGuess').disabled = true;
    el('nextGuess').textContent = 'Start round';
    el('questionText').textContent = 'Listen and choose the chord';
    el('roundProgress').textContent = '10 questions · listen and choose';
    refreshProgress();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelResultTimer(); stopSound(); } });
  window.addEventListener('pagehide', () => { cancelResultTimer(); stopSound(); });
  refreshProgress();
})();
