'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
let lastAudibleVolume = 1;
try {
  const saved = JSON.parse(localStorage.getItem('guitar-song-volume') || 'null');
  if (saved && typeof saved.volume === 'number' && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) {
    audio.volume = saved.volume;
    audio.muted = saved.muted === true;
    if (typeof saved.lastAudible === 'number' && saved.lastAudible > 0 && saved.lastAudible <= 1)
      lastAudibleVolume = saved.lastAudible;
  }
} catch {}
function syncVolume() {
  const percentage = Math.round(audio.volume * 100);
  const silent = audio.muted || audio.volume === 0;
  if (audio.volume > 0) lastAudibleVolume = audio.volume;
  for (const prefix of ['song', 'reader', 'tools', 'stage']) {
    $(prefix + 'Volume').value = percentage;
    $(prefix + 'Volume').setAttribute('aria-valuetext', percentage + ' percent' + (silent ? ', muted' : ''));
    $(prefix + 'VolumeValue').textContent = percentage + '%';
    const mute = $(prefix + 'Mute');
    mute.textContent = prefix === 'stage' ? (silent ? '🔇' : '🔊') : (silent ? 'Unmute' : 'Mute');
    mute.setAttribute('aria-label', silent ? 'Unmute song' : 'Mute song');
    mute.setAttribute('aria-pressed', String(silent));
  }
  try {
    localStorage.setItem('guitar-song-volume', JSON.stringify({
      volume: audio.volume, muted: audio.muted, lastAudible: lastAudibleVolume
    }));
  } catch {}
}
for (const prefix of ['song', 'reader', 'tools', 'stage']) {
  $(prefix + 'Volume').oninput = event => {
    audio.volume = Math.max(0, Math.min(100, Number(event.target.value))) / 100;
    audio.muted = audio.volume === 0;
    syncVolume();
  };
  $(prefix + 'Mute').onclick = () => {
    if (audio.muted || audio.volume === 0) {
      if (audio.volume === 0) audio.volume = lastAudibleVolume;
      audio.muted = false;
    } else audio.muted = true;
    syncVolume();
  };
}
audio.addEventListener('volumechange', syncVolume);
syncVolume();
let preferredZoom = 1.5, readerMode = false, readerControlsOpen = false, chordFocus = false, cleanSongLayout = true;
try {
  const saved = Number(localStorage.getItem('guitar-reading-zoom'));
  if (saved >= 1 && saved <= 3) preferredZoom = saved;
  readerMode = localStorage.getItem('guitar-reading-view') === 'full';
  cleanSongLayout = localStorage.getItem('guitar-clean-song-layout') !== 'false';
  if(cleanSongLayout)readerMode=false;
} catch {}
let songs = [], song = null, page = 1, zoom = preferredZoom, pageToken = 0;
let alternatePdf = null, pairedPdf = null;
let pageReady = false, following = false, activeCue = null, pendingCue = null;
let loopA = null, loopB = null, looping = false, busy = false;
let audioVariant = 'original', switchingTrack = false, switchToken = 0;
const api = '/api/song-library';
const clock = value => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
function status(message) { $('status').textContent = message; }
function message(error) {
  const text = error.message || String(error);
  status(text);
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const dialog = dialogs.at(-1);
  if (dialog) {
    let alert = dialog.querySelector('.dialogerror');
    if (!alert) {
      alert = document.createElement('p'); alert.className = 'dialogerror'; alert.setAttribute('role', 'alert');
    }
    const panel = dialog.querySelector('.dialogbody:not([hidden])');
    if (panel && alert.parentElement !== panel) panel.prepend(alert);
    alert.textContent = text;
    alert.scrollIntoView({ block: 'nearest' });
  }
}
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
async function request(path = '', options = {}) {
  const response = await fetch(api + path, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.message || json.detail || `Request failed (${response.status}).`);
  return json;
}
async function operation(action) {
  if (busy) return;
  document.querySelectorAll('.dialogerror').forEach(element => element.remove());
  busy = true;
  const buttons = [...document.querySelectorAll('button')];
  const prior = buttons.map(button => button.disabled);
  buttons.forEach(button => { button.disabled = true; });
  try { await action(); }
  catch (error) { message(error); }
  finally {
    busy = false;
    buttons.forEach((button, i) => { if (button.isConnected) button.disabled = prior[i]; });
    update();
  }
}
function pdfStem(item) {
  return (item.pdfStem || item.title).trim().toLowerCase();
}
// Analysis belongs to the displayed sheet; use the shared timeline until it is analyzed.
function analysisTarget() {
  const pdf = alternatePdf || song;
  return {id: pdf?.id, variant: pdf?.variant || '', pdf};
}
function activeChordAnalysis() {
  const {pdf, variant} = analysisTarget();
  return (variant === 'simple' ? song?.simpleChordAnalysis : pdf?.chordAnalysis) || song?.chordAnalysis;
}
function isSimplePdf(item) {
  return item.variant === 'simple' || pdfStem(item).endsWith('-simple');
}
function findPairedPdf(item) {
  const stem = pdfStem(item);
  const base = stem.replace(/-simple$/, '');
  const matching = songs.filter(candidate => {
    const name = pdfStem(candidate);
    return name === base || name === base + '-simple';
  });
  const other = matching.find(candidate => candidate.id !== item.id);
  return base && matching.length === 2 && other && pdfStem(other) !== stem ? other : null;
}
async function discoverSimplePdf(item) {
  if (pairedPdf || isSimplePdf(item)) return;
  try {
    const response = await fetch(`${api}/${item.id}/simple`, { cache: 'no-store' });
    if (!response.ok) return;
    const metadata = await response.json();
    if (song !== item || !Number.isInteger(metadata.pages)) return;
    pairedPdf = { ...item, ...metadata, variant: 'simple' };
    showPlayingChord(audio.currentTime);
    update();
  } catch {
    // The standard PDF remains usable if the companion lookup fails.
  }
}
let followTake = null, takingSongRecording = false, takePlayback = null;
function isRecordingFollow() { return followTake?.active === true; }
function update() {
  const pdf = alternatePdf || song;
  $('simpleVersionControl').hidden = !pairedPdf;
  $('simpleVersion').checked = !!pdf && isSimplePdf(pdf);
  $('simpleVersion').disabled = busy;
  $('chordListButton').disabled = $('watchLesson').disabled = busy || !song;
  $('watchLesson').hidden = !song?.lessonUrl;
  const hasSong = !!song, hasAudio = hasSong && song.hasAudio;
  for (const id of ['audioButton', 'notesButton', 'readerNotes', 'replacePdfButton', 'deleteSongButton', 'previous', 'next', 'zoomIn', 'zoomOut', 'cuesButton'])
    $(id).disabled = busy || !hasSong;
  $('previous').hidden = $('next').hidden = pdf?.pages === 1;
  $('previous').disabled ||= page <= 1;
  $('next').disabled ||= !song || page >= pdf.pages;
  $('zoomIn').disabled ||= zoom >= 3 || !pageReady;
  $('zoomOut').disabled ||= zoom <= 1 || !pageReady;
  for (const id of ['play', 'back', 'forward', 'songStart', 'seek', 'speed', 'setA', 'setB', 'follow', 'cueMark',
    'readerPlay', 'readerBack', 'readerForward', 'clearLoop'])
    $(id).disabled = busy || switchingTrack || !hasAudio;
  for (const id of ['cueMark', 'cuesButton']) $(id).disabled ||= !!alternatePdf;
  $('markCue').disabled = busy || switchingTrack || !hasAudio || !pageReady || !!alternatePdf;
  $('loop').disabled = busy || switchingTrack || !hasAudio || loopA === null || loopB === null;
  $('readerLoop').disabled = $('loop').disabled;
  $('rhythmButton').disabled = busy || !hasAudio;
  $('analyzeChordsButton').disabled = busy || !hasAudio;
  $('editChordTimeline').disabled = busy || takingSongRecording || isRecordingFollow() || !hasAudio || !activeChordAnalysis()?.changes.length;
  $('timingCalibrationButton').disabled = busy || takingSongRecording || isRecordingFollow();
  $('chordMatchButton').disabled = busy || !hasAudio || !activeChordAnalysis()?.changes.some(change => change.name);$('readerChordMatch').disabled=$('chordMatchButton').disabled;
  $('recordReviewButton').disabled = busy || switchingTrack || !hasAudio;
  $('rhythmSummary').textContent = song?.rhythm ? `${song.rhythm.meter} · ${song.rhythm.bpm} BPM` : '';
  $('addBacking').disabled = busy || switchingTrack || !hasAudio;
  $('originalTrack').disabled = busy || switchingTrack || !hasAudio;
  $('backingTrack').disabled = busy || switchingTrack || !song?.hasBacking;
  $('stageTrack').disabled = $('trackToggle').disabled = $('readerTrack').disabled = busy || switchingTrack || !song?.hasBacking;
  $('originalTrack').setAttribute('aria-pressed', String(audioVariant === 'original'));
  $('backingTrack').setAttribute('aria-pressed', String(audioVariant === 'backing'));
  $('trackToggle').textContent = switchingTrack ? 'Switching…' : !song?.hasBacking
    ? 'Original · no backing' : audioVariant === 'original' ? 'Original → tap for backing' : 'Backing → tap for original';
  $('stageTrack').textContent = $('readerTrack').textContent = audioVariant === 'backing' ? 'Backing' : 'Original';
  $('addBacking').textContent = song?.hasBacking ? 'Change backing MP3' : 'Add backing MP3';
  $('backingHint').textContent = song?.hasBacking
    ? 'Backing ready. Both versions share the same PDF cues. Switching keeps your playback position.'
    : 'Create a backing from this exact original MP3 with the Mac helper, then attach it. PDF cues will be preserved.';
  $('audioButton').textContent = hasAudio ? 'Change MP3' : 'Add MP3';
  $('audioEmpty').hidden = hasAudio;
  $('songTitle').textContent = song?.title || 'Choose a song';
  $('songTitle').title = song?.title || '';
  $('pageNumber').textContent = song ? `${pdf.pages === 1 ? '' : `${page} / ${pdf.pages} · `}${Math.round(zoom * 100)}%` : 'No PDF selected';
  $('cueCount').textContent = song?.cues.length || 0;
  $('play').textContent = audio.paused ? 'Play' : 'Pause';
  $('readerPlay').textContent = $('play').textContent;
  window.AutoPdfFollow?.refreshUI();
  const autoPdfState=window.AutoPdfFollow?.state();
  $('follow').textContent = autoPdfState?.enabled ? (autoPdfState.suspended?'Follow paused':'Follow on') : following ? 'Follow on' : 'Follow off';
  $('follow').setAttribute('aria-pressed', String(autoPdfState?.enabled ? !autoPdfState.suspended : following));
  $('loop').textContent = looping ? 'Loop on' : 'Loop off';
  $('loop').setAttribute('aria-pressed', String(looping));
  $('readerLoop').textContent = $('loop').textContent;
  $('readerLoop').setAttribute('aria-pressed', String(looping));
  $('loopTimes').textContent = `A ${loopA === null ? '—' : clock(loopA)} · B ${loopB === null ? '—' : clock(loopB)}`;
  $('toolsLoopTimes').textContent = $('loopTimes').textContent;
  const recording = isRecordingFollow();
  $('recordFollow').disabled = busy || switchingTrack || !hasAudio || !pageReady || !!alternatePdf || recording;
  $('stopRecordFollow').hidden = !recording;
  $('followDown').hidden = !recording || readerMode || cleanSongLayout;
  $('readerFollowDown').hidden = !recording || !(readerMode || cleanSongLayout);
  document.body.classList.toggle('follow-recording',recording);
  for (const id of ['libraryButton', 'toolsButton', 'readerTools', 'loopTools', 'readerToggle', 'readerControlsToggle', 'chordFocusToggle'])
    $(id).disabled = recording;
  if (takingSongRecording) {
    for (const id of ['libraryButton','toolsButton','readerTools','loopTools','play','readerPlay','back','forward','readerBack','readerForward','songStart','seek','loop','readerLoop','readerTrack','stageTrack','trackToggle','follow','cuesButton','markCue','watchLesson'])
      $(id).disabled = true;
  }
  if (recording) {
    for (const id of ['simpleVersion', 'zoomIn', 'zoomOut', 'back', 'forward', 'songStart', 'seek', 'follow', 'cuesButton',
      'markCue', 'readerBack', 'readerForward', 'loop', 'readerLoop', 'readerTrack', 'stageTrack', 'trackToggle', 'watchLesson'])
      $(id).disabled = true;
  }
  $('stageBack').disabled=$('back').disabled||Boolean(takePlayback)||Boolean(takingSongRecording);
  $('stageForward').disabled=$('forward').disabled||Boolean(takePlayback)||Boolean(takingSongRecording);
  $('toolsBack').disabled=$('back').disabled;$('toolsForward').disabled=$('forward').disabled;
  $('toolsLoopToggle').disabled=$('loop').disabled;$('toolsLoopToggle').textContent=$('loop').textContent;$('toolsLoopToggle').setAttribute('aria-pressed',String(looping));
  $('readerToggle').hidden = cleanSongLayout;
  $('readerToggle').textContent = readerMode ? 'Split view' : 'FullScreen';
  $('readerToggle').setAttribute('aria-pressed', String(readerMode));
}
function setFollow(value) { following = value; activeCue = null; update(); }
let pendingPageX = 0;
function hasHebrewTitle() {
  return /[א-ת]/u.test(song?.title ?? '');
}
function pagePoint() {
  const pane = $('pdfViewport'), image = $('pdfImage');
  const atRightEdge = pane.scrollWidth - pane.clientWidth - pane.scrollLeft <= 1;
  return {
    y: pane.scrollTop / Math.max(1, image.clientHeight),
    x: hasHebrewTitle() && atRightEdge ? 'right' : pane.scrollLeft / Math.max(1, image.clientWidth)
  };
}
function cueScrollTop(position, pageAnchor) {
  const pane = $('pdfViewport'), image = $('pdfImage');
  const bottom = Math.max(0, pane.scrollHeight - pane.clientHeight);
  const top = Number.isFinite(pageAnchor) ? pageAnchor * image.clientHeight : position * bottom;
  return Math.max(0, Math.min(bottom, top));
}
function songStartEdge() { return hasHebrewTitle() ? 'right' : 0; }
function scrollPdfHorizontally(horizontal) {
  const pane = $('pdfViewport');
  pane.scrollLeft = horizontal === 'right' ? pane.scrollWidth - pane.clientWidth : horizontal * $('pdfImage').clientWidth;
}
function restorePosition(position, pageAnchor = null, horizontal = 0) {
  $('pdfViewport').scrollTop = cueScrollTop(position, pageAnchor);
  scrollPdfHorizontally(horizontal);
}
function continuousCue(cue, breaks) {
  const index = Math.max(0, Math.min(breaks.length - 2, cue.page - 1));
  const height = $('pdfImage').clientHeight;
  const fraction = breaks[index + 1] - breaks[index];
  const offset = Number.isFinite(cue.pageAnchor) ? cue.pageAnchor * fraction
    : cue.position * Math.max(0, fraction - $('pdfViewport').clientHeight / Math.max(1, height));
  return breaks[index] + offset;
}
function scrollBetweenCues(current, next, time) {
  if (!pageReady || !current || !next || next.time <= current.time || next.page < current.page) return;
  const pane = $('pdfViewport');
  const breaks = (alternatePdf || song).pageBreaks;
  const start = cueScrollTop(current.position, breaks ? continuousCue(current, breaks) : current.pageAnchor);
  const end = breaks ? cueScrollTop(0, continuousCue(next, breaks))
    : next.page === current.page ? cueScrollTop(next.position, next.pageAnchor)
    : Math.max(0, pane.scrollHeight - pane.clientHeight);
  const progress = Math.max(0, Math.min(1, (time - current.time) / (next.time - current.time)));
  const top = start + (end - start) * progress;
  if (Math.abs(pane.scrollTop - top) >= 1) pane.scrollTop = top;
}
function seekPdf(cue) {
  const destination = cue || { page: 1, position: 0, pageAnchor: 0 };
  const pdf = alternatePdf || song;
  const destinationPage = Math.max(1, Math.min(pdf.pages, destination.page));
  const anchor = pdf.pageBreaks ? continuousCue(destination, pdf.pageBreaks) : destination.pageAnchor ?? null;
  if (pageReady && page === destinationPage) {
    restorePosition(destination.position, anchor, pagePoint().x);
  } else {
    renderPage(destinationPage, destination.position, anchor, undefined, pdf.pageBreaks ? destination : null);
  }
}
async function renderPage(number = page, position = 0, pageAnchor = null, horizontal = pageReady ? pagePoint().x : pendingPageX, logicalCue = null) {
  if (!song) return;
  const pdf = alternatePdf || song;
  page = Math.max(1, Math.min(pdf.pages, number));
  if (isRecordingFollow()) flushFollowScroll();
  const token = ++pageToken;
  pendingPageX = horizontal;
  pageReady = false;
  window.GuitarChordViewer?.clearPage();
  $('pageLoading').hidden = false;
  update();
  try {
    const params = new URLSearchParams({ v: pdf.updated });
    if (pdf.variant) params.set('variant', pdf.variant);
    const response = await fetch(`${api}/${pdf.id}/page/${page}?${params}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.detail || 'Could not render this PDF page.');
    }
    const blob = await response.blob();
    if (token !== pageToken) return;
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      if (token !== pageToken) { URL.revokeObjectURL(url); return; }
      const oldUrl = $('pdfImage').src;
      $('pdfImage').src = url;
      $('pdfImage').style.width = `${zoom * 100}%`;
      $('pdfImage').hidden = false;
      $('emptySheet').hidden = true;
      await $('pdfImage').decode();
      if (token !== pageToken) return;
      restorePosition(position, logicalCue ? continuousCue(logicalCue, pdf.pageBreaks) : pageAnchor, pendingPageX);
      if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      pageReady = true;
      if (isRecordingFollow() && !audio.paused) addFollowMark(cueAtPlayhead());
      window.GuitarChordViewer?.showPage({ id: pdf.id, version: pdf.updated, variant: pdf.variant, page });
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  } catch (error) { if (token === pageToken) message(error); }
  finally { if (token === pageToken) { $('pageLoading').hidden = true; update(); } }
}
function scrollPosition() {
  const pane = $('pdfViewport');
  return pane.scrollTop / Math.max(1, pane.scrollHeight - pane.clientHeight);
}
async function refreshLibrary() {
  songs = await request();
  renderLibrary();
}
function renderLibrary() {
  const query = $('search').value.toLowerCase();
  const list = $('songList'); list.replaceChildren();
  const filtered = songs.filter(item => item.title.toLowerCase().includes(query));
  for (const item of filtered) {
    const row = document.createElement('div'); row.className = 'songrow';
    const description = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = `${item.pages} pages · ${item.hasBacking ? 'Original + backing · ' : item.hasAudio ? 'MP3 ready · ' : 'Add MP3 · '}${item.hasAudio ? clock(item.duration) + ' · ' : ''}${item.cues.length} cues`;
    description.append(title, detail);
    const button = document.createElement('button'); button.textContent = 'Open';
    button.onclick = () => { if (!busy) selectSong(item, true); };
    row.append(description, button); list.append(row);
  }
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'hint';
    empty.textContent = songs.length ? 'No matching songs.' : 'Your library is empty. Import a chord PDF to begin.';
    list.append(empty);
  }
  $('libraryCount').textContent = `${songs.length} songs`;
}
let countInEnabled = true;
try { countInEnabled = localStorage.getItem('guitar-song-count-in') !== 'false'; } catch {}
$('songCountInEnabled').checked = countInEnabled;
$('songCountInEnabled').onchange = () => {
  countInEnabled = $('songCountInEnabled').checked;
  try { localStorage.setItem('guitar-song-count-in', String(countInEnabled)); } catch {}
  status(countInEnabled ? 'Five-second count-in enabled.' : 'Count-in off. Songs start immediately.');
};
let pendingSongStart = null, countInAudio = null;
function stopCountInBeeps(pending) {
  for (const voice of pending.voices) { try { voice.stop(); } catch {} }
  pending.voices = [];
}
async function scheduleCountInBeeps(pending, player) {
  if (audio.muted || audio.volume === 0) return;
  try {
    countInAudio ??= new AudioContext();
    await countInAudio.resume();
    if (pendingSongStart !== pending || countInAudio.state !== 'running') return;
    const position = player.currentTime || 0;
    const countRhythm = SongRhythmPoints.at(song?.rhythm, position);
    const bpm = countRhythm?.bpm || 60;
    const beat = 60 / bpm, rate = player.playbackRate || 1;
    const anchor = Number.isFinite(countRhythm?.firstDownbeat) ? countRhythm.firstDownbeat : position;
    const beats = rhythmBeats[countRhythm?.meter] || 4;
    const remaining = Math.max(0, (pending.deadline - performance.now()) / 1000);
    const first = Math.ceil((position - remaining * rate - anchor) / beat);
    const last = Math.ceil((position - anchor) / beat) - 1;
    for (let index = first; index <= last; index++) {
      const delay = remaining + (anchor + index * beat - position) / rate;
      if (delay < .005 || delay >= remaining) continue;
      const start = countInAudio.currentTime + delay;
      const oscillator = countInAudio.createOscillator(), gain = countInAudio.createGain();
      const accent = ((index % beats) + beats) % beats === 0;
      oscillator.type = 'sine';
      oscillator.frequency.value = accent ? 1046.5 : 784;
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime((accent ? .14 : .09) * audio.volume, start + .005);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .09);
      oscillator.connect(gain).connect(countInAudio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      pending.voices.push(oscillator);
      oscillator.start(start); oscillator.stop(start + .1);
    }
  } catch {}
}
function cancelSongStart() {
  if (!pendingSongStart) return;
  const pending = pendingSongStart;
  pendingSongStart = null;
  clearTimeout(pending.timer);
  stopCountInBeeps(pending);
  $('songCountIn').close();
  pending.resolve(false);
}
function songCountIn(start, valid = () => true, player = audio) {
  cancelSongStart();
  if (document.hidden || !valid()) return Promise.resolve(false);
  if (!countInEnabled) return Promise.resolve().then(start).then(() => true);
  return new Promise((resolve, reject) => {
    const pending = {resolve, timer:null, voices:[], deadline:performance.now() + 5000};
    pendingSongStart = pending;
    $('songCountInNumber').textContent = '5';
    $('songCountIn').showModal();
    void scheduleCountInBeeps(pending, player);
    const tickCount = () => {
      if (pendingSongStart !== pending) return;
      if (document.hidden || !valid()) { cancelSongStart(); return; }
      const remaining = Math.ceil((pending.deadline - performance.now()) / 1000);
      if (remaining > 0) {
        $('songCountInNumber').textContent = String(remaining);
        pending.timer = setTimeout(tickCount, Math.min(100, pending.deadline - performance.now()));
        return;
      }
      pendingSongStart = null;
      stopCountInBeeps(pending);
      $('songCountIn').close();
      Promise.resolve().then(start).then(() => resolve(true), reject);
    };
    pending.timer = setTimeout(tickCount, 100);
  });
}
function startSongPlayback() {
  if (!audio.paused) return Promise.resolve(true);
  const id = song?.id, source = audio.src;
  return songCountIn(() => audio.play(), () => song?.id === id && audio.src === source);
}
$('cancelSongCountIn').onclick = cancelSongStart;
$('songCountIn').addEventListener('cancel', event => { event.preventDefault(); cancelSongStart(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelSongStart(); });
window.addEventListener('pagehide', cancelSongStart);

function selectSong(item, autoplay = false) {
  cancelSongStart();
  window.SongChordMatch?.stop();
  switchToken++; switchingTrack = false; audioVariant = 'original';
  audio.pause(); audio.removeAttribute('src'); audio.load();
  song = structuredClone(item);
  alternatePdf = null;
  pairedPdf = findPairedPdf(song);
  void discoverSimplePdf(song);
  window.GuitarChordViewer?.reset(song.id);
  page = 1; zoom = preferredZoom; loopA = loopB = null; looping = false;
  setFollow(false);
  $('currentSection').textContent = 'No cue yet';
  $('nextSection').textContent = 'Move the PDF to a section, then tap Mark here.';
  try { localStorage.setItem('guitar-last-song', song.id); } catch {}
  closeDialog('libraryDialog');
  if (song.hasAudio) {
    audio.src = `${api}/${song.id}/audio?v=${encodeURIComponent(song.updated)}`;
    audio.playbackRate = Number($('speed').value);
    if (autoplay) startSongPlayback().catch(() => status('Recording loaded. Tap Play to begin.'));
  }
  $('seek').value = 0; $('seek').max = Math.max(1, song.duration);
  $('clock').textContent = `0:00 / ${clock(song.duration)}`;
  $('readerClock').textContent = $('clock').textContent;
  status(song.hasAudio ? (song.cues.length ? 'Ready. Follow turns on when playback starts.' : 'Ready. Scroll the PDF and mark sections to enable following.') : 'PDF imported. Tap Add MP3 to pair a recording.');
  showPlayingChord(0);
  renderPage(1, 0, null, songStartEdge()); update();
}
async function saveSettings(settings) {
  const id = song.id;
  const result = await request(`/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
  });
  songs = songs.map(item => item.id === id ? result : item);
  if (song?.id === id) song = result;
  renderLibrary(); update();
  return result;
}
async function uploadPdf(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file.');
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF files are limited to 20 MB.');
  return request('/pdf?name=' + encodeURIComponent(file.name), {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file
  });
}
async function uploadAudio(id, file, variant = 'original') {
  if (!file.name.toLowerCase().endsWith('.mp3')) throw new Error('Choose an MP3 recording.');
  if (file.size > 100 * 1024 * 1024) throw new Error('MP3 files are limited to 100 MB.');
  return request(`/${id}/audio?name=${encodeURIComponent(file.name)}&variant=${variant}`, {
    method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: file
  });
}
function audioSelection(files) {
  const selected = [...files];
  if (!selected.length) return null;
  if (selected.length > 2) throw new Error('Choose one original MP3, or its original/backing pair.');
  for (const file of selected) {
    if (!file.name.toLowerCase().endsWith('.mp3')) throw new Error('Choose MP3 recordings.');
    if (file.size > 100 * 1024 * 1024) throw new Error('MP3 files are limited to 100 MB.');
  }
  if (selected.length === 1) {
    if (/-backing\.mp3$/i.test(selected[0].name)) throw new Error('Choose the original MP3 too. Use Add backing MP3 for a backing alone.');
    return { original: selected[0], backing: null };
  }
  const original = selected.find(file => /-original\.mp3$/i.test(file.name));
  const expected = original?.name.replace(/-original(?=\.mp3$)/i, '-backing').toLowerCase();
  const backing = selected.find(file => file !== original && file.name.toLowerCase() === expected);
  if (!original || !backing) throw new Error('Select a matching pair named song-original.mp3 and song-backing.mp3.');
  return { original, backing };
}
async function uploadAudioSelection(id, selection) {
  let result = await uploadAudio(id, selection.original);
  if (selection.backing) {
    try {
      result = await uploadAudio(id, selection.backing, 'backing');
      result.backingImportMessage = 'Matching backing attached automatically.';
    } catch (error) {
      result.backingImportMessage = `Original saved. Selected backing was not attached: ${error.message}`;
    }
  }
  return result;
}
function audioSavedStatus(result, prefix) {
  if (!result.hasAudio) return prefix + ' Attach an MP3 when ready.';
  return prefix + ' ' + (result.backingImportMessage || (result.hasBacking ? 'Original and backing ready.' : 'Start playback, then mark PDF sections.'));
}
function loadMediaAt(url, time, valid = () => true) {
  return new Promise((resolve, reject) => {
    let timer;
    const clean = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', failed); };
    const ready = () => {
      clean();
      if (!valid()) { resolve(); return; }
      audio.currentTime = Math.max(0, Math.min(time, Number.isFinite(audio.duration) ? audio.duration : time));
      resolve();
    };
    const failed = () => { clean(); reject(new Error('Could not load that audio version.')); };
    audio.addEventListener('loadedmetadata', ready);
    audio.addEventListener('error', failed);
    timer = setTimeout(() => { clean(); reject(new Error('Audio version took too long to load.')); }, 20000);
    audio.src = url; audio.load();
  });
}
async function switchTrack(variant, resume = null) {
  if (!song?.hasAudio || switchingTrack || variant === audioVariant) return;
  if (variant === 'backing' && !song.hasBacking) { status('First attach the backing MP3 in Tools.'); return; }
  const token = ++switchToken;
  const time = audio.currentTime, rate = audio.playbackRate, playing = resume ?? !audio.paused;
  const previousUrl = audio.src;
  switchingTrack = true; audio.pause(); update();
  try {
    await loadMediaAt(`${api}/${song.id}/audio?variant=${variant}&v=${encodeURIComponent(song.updated)}`, time, () => token === switchToken);
    if (token !== switchToken) return;
    audioVariant = variant; audio.playbackRate = rate;
    if (playing) await audio.play().catch(() => status('Tap Play to continue with this version.'));
    status((variant === 'backing' ? 'Backing track' : 'Original recording') + ' · playback position and PDF cues preserved.');
  } catch (error) {
    if (token !== switchToken) return;
    try {
      await loadMediaAt(previousUrl, time, () => token === switchToken);
      if (token !== switchToken) return;
      audio.playbackRate = rate;
      if (playing) await audio.play().catch(() => {});
    } catch {}
    message(error);
  } finally {
    if (token === switchToken) { switchingTrack = false; activeCue = null; update(); tick(); }
  }
}
function cueAtPlayhead() {
  const anchor = Math.min(1, Math.max(0, pagePoint().y));
  const breaks = song.pageBreaks;
  const index = breaks ? Math.min(breaks.length - 2, breaks.findLastIndex(offset => offset <= anchor)) : 0;
  const localAnchor = breaks ? (anchor - breaks[index]) / (breaks[index + 1] - breaks[index]) : anchor;
  return { time: Math.min(audio.currentTime, song.duration), page: breaks ? index + 1 : page,
    position: breaks ? localAnchor : scrollPosition(), zoom, pageAnchor: localAnchor, label: '' };
}
function mark() {
  if (!song?.hasAudio || !pageReady) return;
  audio.pause();
  pendingCue = cueAtPlayhead();
  $('cuePart').value = 'Verse'; $('customCueLabel').hidden = true;
  $('cueName').value = '';
  $('markSummary').textContent = `${clock(pendingCue.time)} · PDF page ${pendingCue.page} · ${Math.round(zoom * 100)}% zoom`;
  openDialog('markDialog');
}
function addFollowMark(cue) {
  const marks = followTake.marks;
  const previous = marks.at(-1);
  const breaks = song.pageBreaks;
  const fraction = breaks ? breaks[cue.page] - breaks[cue.page - 1] : 1;
  if (previous?.page === cue.page && Math.abs(previous.pageAnchor - cue.pageAnchor) * fraction * $('pdfImage').clientHeight < 12) return;
  cue.label = 'Follow ' + (marks.length + 1);
  if (previous && cue.time - previous.time < .25) {
    cue.label = previous.label;
    marks[marks.length - 1] = cue;
  } else if (marks.length < 300) marks.push(cue);
  $('stopRecordFollow').textContent = `Stop recording · ${marks.length}`;
}
function flushFollowScroll() {
  clearTimeout(followTake.timer);
  if (followTake.pending) addFollowMark(followTake.pending);
  followTake.pending = null;
}
let followHold = null;
function queueFollowMark() {
  clearTimeout(followTake.timer);
  if (!followHold && followTake.pending) followTake.timer = setTimeout(flushFollowScroll, 1000);
}
function captureFollowScroll() {
  if (!isRecordingFollow() || !pageReady || audio.paused) return;
  const top = $('pdfViewport').scrollTop;
  if (top === followTake.top) return;
  followTake.top = top;
  followTake.pending = cueAtPlayhead();
  queueFollowMark();
}
function stepFollowDown(held = false) {
  if (!isRecordingFollow() || !pageReady) return;
  const pane = $('pdfViewport');
  pane.scrollTop += held ? 8 : Math.min(38, Math.max(16, Math.round(pane.clientHeight * .1)));
  captureFollowScroll();
}
function releaseFollowDown() {
  if (!followHold) return;
  clearTimeout(followHold.delay);
  clearInterval(followHold.repeat);
  followHold = null;
  if (isRecordingFollow()) queueFollowMark();
}
$('pdfViewport').addEventListener('scroll', captureFollowScroll, { passive: true });
for (const id of ['followDown', 'readerFollowDown']) {
  const button = $(id);
  button.addEventListener('pointerdown', event => {
    if (!isRecordingFollow() || followHold || event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    followHold = {pointer: event.pointerId};
    clearTimeout(followTake.timer);
    stepFollowDown();
    followHold.delay = setTimeout(() => {
      stepFollowDown(true);
      followHold.repeat = setInterval(() => stepFollowDown(true), 120);
    }, 350);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(type, event => {
      if (followHold?.pointer === event.pointerId) releaseFollowDown();
    });
  button.onclick = event => { if (event.detail === 0) stepFollowDown(); };
}
window.addEventListener('pagehide', releaseFollowDown);
function reviewFollowMarks() {
  const list = $('recordFollowList');
  list.replaceChildren();
  const marks = followTake.marks;
  $('recordFollowCount').textContent = `${marks.length} ${marks.length === 1 ? 'mark' : 'marks'}`;
  $('saveRecordedFollow').disabled = !marks.length;
  for (const [index, cue] of marks.entries()) {
    const row = document.createElement('div');
    row.className = 'cuerow';
    const label = document.createElement('span');
    label.textContent = `${clock(cue.time)} · Page ${cue.page} · ${Math.round(cue.position * 100)}% down`;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${cue.label} at ${clock(cue.time)}`);
    remove.onclick = () => { marks.splice(index, 1); reviewFollowMarks(); };
    row.append(label, remove);
    list.append(row);
  }
}
function stopRecordingFollow() {
  if (!isRecordingFollow()) return;
  releaseFollowDown();
  flushFollowScroll();
  followTake.active = false;
  audio.pause();
  update();
  status('Review your recorded marks before saving.');
  reviewFollowMarks();
  openDialog('recordFollowReview');
}
$('recordFollow').onclick = () => {
  if ($('recordFollow').disabled) return;
  closeDialog('cueDialog');
  if (readerMode && !readerControlsOpen) $('readerControlsToggle').click();
  followTake = { active: true, marks: [], pending: null, timer: null, top: $('pdfViewport').scrollTop };
  looping = false;
  setFollow(false);
  addFollowMark(cueAtPlayhead());
  status('Recording Follow. Tap or hold ↓ to scroll, then pause for a second to mark the position.');
  startSongPlayback().then(started => { if (!started) stopRecordingFollow(); }).catch(error => {
    stopRecordingFollow();
    message(error);
  });
};
$('stopRecordFollow').onclick = stopRecordingFollow;
$('recordFollowReview').addEventListener('close', () => { followTake = null; });
$('saveRecordedFollow').onclick = () => operation(async () => {
  const cues = [...song.cues];
  for (const mark of followTake.marks)
    if (!cues.some(cue => Math.abs(cue.time - mark.time) < .25)) cues.push(mark);
  if (cues.length > 300) throw new Error('A song can have up to 300 cues. Remove some recorded marks before saving.');
  if (cues.length !== song.cues.length) await saveSettings({ cues: cues.sort((a, b) => a.time - b.time) });
  closeDialog('recordFollowReview');
  status('Review complete. Follow turns on next time you press Play.');
});
function renderCues() {
  const list = $('cueList'); list.replaceChildren();
  for (const [index, cue] of song.cues.entries()) {
    const row = document.createElement('div'); row.className = 'cuerow';
    const jump = document.createElement('button');
    jump.textContent = `${clock(cue.time)} · ${cue.label} · page ${cue.page}`;
    jump.onclick = () => {
      if (busy) return;
      window.AutoPdfFollow?.pause();
      audio.currentTime = cue.time; activeCue = null;
      seekPdf(cue);
      closeDialog('cueDialog');
    };
    const remove = document.createElement('button'); remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${cue.label} cue`);
    remove.onclick = () => operation(async () => {
      await saveSettings({ cues: song.cues.filter((_, i) => i !== index) });
      activeCue = null; renderCues(); status('Cue removed.');
    });
    row.append(jump, remove); list.append(row);
  }
  if (!song.cues.length) list.textContent = 'No cues yet. Position the PDF and tap Mark here.';
}
function chordIndexAt(time, changes) {
  let low = 0, high = changes?.length ?? 0;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  // Older analyses included null entries to clear a highlight. Hold the last known chord.
  while (low && !changes[low - 1].name) low--;
  return low - 1;
}
function playbackChord(name) {
  return name ? window.GuitarChordViewer?.alternate(name) || name : name;
}
document.addEventListener('guitar-chord-alternate-change', event => {
  if (song?.id !== event.detail.id) return;
  const matching = Boolean(window.SongChordMatch?.progress?.());
  window.SongChordMatch?.stop();
  stageDiagramName = '';
  showPlayingChord((takePlayback ?? audio).currentTime);
  status(matching ? 'Alternate chord saved. Start Chord match again to use the new choices.' : 'Alternate chord saved for this song.');
});
function showPlayingChord(time) {
  const changes = activeChordAnalysis()?.changes;
  const index = chordIndexAt(time, changes);
  const badge = $('playingChord');
  $('chordStrip').hidden = true;
  badge.textContent = playbackChord(changes?.[index]?.name) || '';
  $('songTitle').hidden = false;
  window.SongChordMatch?.show(index);
  showFullscreenChords(time, changes, index);
}
let stageDiagramName = '', focusPdfPoint = null, syncingBar = false, syncTapTime = null;
function showFullscreenChords(time, changes, index) {
  const ready = Boolean(changes?.some(change => change.name));
  const focused = ready && (readerMode || cleanSongLayout) && chordFocus;
  $('fullscreenChords').hidden = !focused;
  $('stageBeats').hidden = !ready && !pairedPdf;
  $('stageBeats').classList.toggle('simple-only', !ready);
  $('stageTransport').hidden = !(readerMode || cleanSongLayout) || !song?.hasAudio;
  $('chordFocusToggle').hidden = !ready || !(readerMode || cleanSongLayout);
  $('readerPageControls').hidden = (readerMode && !readerControlsOpen) || (cleanSongLayout && focused);
  document.body.classList.toggle('chord-focus', focused);
  document.body.classList.toggle('split-bar-view', ready && !readerMode && !focused);
  const bars = $('stageBeats');
  if ((readerMode || focused) && bars.parentElement !== $('readerStage')) $('pdfViewport').before(bars);
  if (!readerMode && !focused && bars.parentElement !== $('readerPageControls')) $('readerPageControls').append(bars);
  syncStageTransport(time);
  $('cleanChordMatchStatus').hidden=!cleanSongLayout||!window.SongChordMatch?.progress?.();
  if (!ready) return;
  const named = changes.map((change, offset) => ({...change, offset})).filter(change => change.name);
  const currentPosition = named.findIndex(change => change.offset === index);
  const current = changes[index] ? {...changes[index], name:playbackChord(changes[index].name)} : null;
  const upcoming = named.filter(change => change.offset > index).map(change => ({...change,name:playbackChord(change.name)}));
  $('stagePrevious').textContent = playbackChord(named[currentPosition - 1]?.name) || '—';
  $('stageCurrent').textContent = current?.name || '—';
  $('stageNext').textContent = upcoming[0]?.name || '—';
  $('stageLater').textContent = upcoming[1]?.name || '—';
  const remaining = upcoming[0] ? Math.max(0, upcoming[0].time - time) : 0;
  const duration = upcoming[0] ? Math.max(.001, upcoming[0].time - (current?.time || 0)) : 1;
  $('stageCountdown').value = upcoming[0] ? 1 - Math.min(1, remaining / duration) : 0;
  $('stageSeconds').textContent = upcoming[0] ? 'Change in ' + remaining.toFixed(1) + ' s' : 'Last chord';
  showChordBeats(time, current?.time, upcoming[0]?.time ?? song?.duration, upcoming[0]?.name);
  const matched = $('playingChord').classList.contains('matched-chord');
  $('stageCurrentCard').classList.toggle('matched', matched);
  $('stageMatch').textContent = matched ? '✓ Matched' : '';
  if (stageDiagramName !== (current?.name || '')) {
    stageDiagramName = current?.name || '';
    $('stageDiagram').replaceChildren();
    const shapes = window.GuitarChords?.shapes(stageDiagramName) || [];
    let preferred;
    try { preferred = JSON.parse(localStorage.getItem('guitar-chords-' + song.id) || '{}').preferred?.[stageDiagramName]; } catch {}
    const shape = shapes.find(option => option.frets.join(',') === preferred) || shapes[0];
    if (shape) $('stageDiagram').append(GuitarChordDiagram(shape, stageDiagramName));
  }
}
function syncStageTransport(time) {
  const player = takePlayback ?? audio;
  $('stagePlay').textContent = player.paused ? 'Play' : 'Pause';
  $('stagePlay').disabled = !song?.hasAudio || Boolean(takingSongRecording);
  $('stageStart').disabled = $('songStart').disabled || Boolean(takePlayback) || Boolean(takingSongRecording);
  $('stageClock').textContent = clock(time) + ' / ' + clock(song?.duration || 0);
  $('stageSeek').max = song?.duration || 1;
  $('stageSeek').value = time;
  $('stageSeek').disabled = Boolean(takingSongRecording) || Boolean(takePlayback) || isRecordingFollow();
  const score = window.SongChordMatch?.progress?.();
  $('stageScore').textContent = score ? 'Matched ' + score.hits + ' / ' + score.total : 'Chord match off';
}
function showChordBeats(time, start, end, nextName) {
  const rhythm = SongRhythmPoints.at(song?.rhythm, time);
  $('addRhythmPoint').disabled = !song?.rhythm || syncingBar || Boolean(takePlayback) || Boolean(takingSongRecording);
  if ($('rhythmPointsDialog').open) $('pointClock').textContent = clock(audio.currentTime);
  const beats = rhythmBeats[rhythm?.meter];
  const bpm = rhythm?.bpm;
  $('stageSyncBar').disabled = !beats || !Number.isFinite(bpm) || syncingBar || Boolean(takePlayback) || Boolean(takingSongRecording);
  const graphic = $('stageBeatGraphic');
  graphic.replaceChildren();
  if (!beats || !Number.isFinite(bpm) || bpm <= 0) {
    $('stageBeatCaption').textContent = 'Set tempo and time signature to show the beats.';
    return;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    $('stageBeatCaption').textContent = 'Waiting for the first chord';
    return;
  }
  const subdivisions = rhythm.meter.endsWith('/8') ? 3 : 1;
  const pulses = beats * subdivisions;
  const beat = 60 / bpm, pulse = beat / subdivisions, bar = beat * beats;
  const aligned = Number.isFinite(rhythm.firstDownbeat);
  if (!syncingBar) $('stageSyncBar').textContent = aligned ? '✓ Bar synced' : 'Bar starts now';
  const anchor = aligned ? rhythm.firstDownbeat : 0;
  const gridTime=cleanSongLayout?Math.min(time,Math.max(0,(song?.duration||time)-.001)):time;
  const currentBar = Math.floor((gridTime - anchor) / bar + 1e-6);
  // Keep song-time coordinates fixed through chord changes.
  const windowBar = cleanSongLayout?currentBar:Math.floor(currentBar / 2) * 2;
  const windowStart = cleanSongLayout?Math.max(0,anchor+windowBar*bar):anchor+windowBar*bar;
  const windowEnd = Math.min(anchor+(windowBar+2)*bar,rhythm.sectionEnd,cleanSongLayout?(song?.duration||Infinity):Infinity);
  const length = Math.max(.001, windowEnd - windowStart);
  $('stageBeatCaption').textContent = (rhythm.pointNumber ? '#' + rhythm.pointNumber + ' · ' : 'Estimated · ') + rhythm.meter + ' · ' + bpm + ' BPM'
    + (aligned ? ' · bar aligned at ' + clock(rhythm.firstDownbeat) : ' · tap Bar starts now on beat 1');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 740 52');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Chord beat progress in ' + rhythm.meter);
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const x = moment => 18 + (moment - windowStart) / length * 650;
  // This is an estimated rhythmic diagram: use whole displayed pulses for
  // chord sections instead of rendering fractional slivers from audio analysis.
  const displayStart = anchor + Math.round((start - anchor) / pulse) * pulse;
  const displayEnd = anchor + Math.round((end - anchor) / pulse) * pulse;
  const timeline = [];
  for (const [sourceIndex, change] of (activeChordAnalysis()?.changes || []).entries()) {
    if (!change.name) continue;
    const nearest = anchor + Math.round((change.time - anchor) / pulse) * pulse;
    const boundary = nearest;
    const previous = timeline.at(-1);
    if (previous?.time === boundary) {
      previous.name = playbackChord(change.name); previous.sourceIndex = sourceIndex;
    } else timeline.push({time: boundary, name:playbackChord(change.name), sourceIndex});
  }

  if(cleanSongLayout){
    $('stageBeatCaption').title=$('stageBeatCaption').textContent;
    $('stageBeatCaption').textContent=(rhythm.pointNumber?'#'+rhythm.pointNumber+' · ':'')+rhythm.meter+' · '+bpm+' BPM';
    CleanChordBars.render(graphic,{time,windowBar,windowStart,windowEnd,bar,pulse,pulses,anchor,timeline,meter:rhythm.meter,matched:index=>window.SongChordMatch?.matched?.(index)||false});
    if(nextName){const remaining=Math.max(0,(end-time)/pulse);$('stageSeconds').textContent='Change in '+remaining.toFixed(1)+(subdivisions>1?' pulses':' beats');}
    return;
  }

  for (let group = windowBar; group <= windowBar + 1; group++) {
    const left = Math.max(windowStart, anchor + group * bar);
    const right = Math.min(windowEnd, anchor + (group + 1) * bar);
    if (right <= left) continue;
    add('rect', {x:x(left), y:3, width:Math.max(1,x(right)-x(left)-4), height:46, rx:8, fill:'#192f45', stroke:'#54758c'});
    const label = group - windowBar + 1;
    const cuts = [left, ...timeline.filter(change => change.time > left + .001 && change.time < right - .001).map(change => change.time), right];
    for (let part = 0; part < cuts.length - 1; part++) {
      const from = cuts[part], to = cuts[part + 1];
      const chordIndex = chordIndexAt(from + .001, timeline);
      const name = timeline[chordIndex]?.name || (from >= start && from < end ? $('stageCurrent').textContent : '');
      const activeChord = from < displayEnd && to > displayStart;
      const sourceIndex = timeline[chordIndex]?.sourceIndex;
      const matched = window.SongChordMatch?.matched?.(sourceIndex) || false;
      const width = Math.max(1, x(to) - x(from) - 4);
      add('rect', {x:x(from)+1,y:16,width,height:31,rx:5,
        fill:matched?'#22573d':activeChord?'#375743':'#203247',stroke:matched?'#8af0b4':activeChord?'#91d6a5':'#647e96','stroke-width':matched?2:1,
        'data-matched':matched,'data-source-index':sourceIndex,
        'data-chord-segment':name,'data-bar-fraction':(to-from)/bar});
      if (matched && width > 22)
        add('text', {x:x(to)-10,y:29,'text-anchor':'middle',fill:'#9affc3','font-size':13,'font-weight':800,'data-match-check':sourceIndex}, '✓');
      if (name && width > 25)
        add('text', {x:(x(from)+x(to))/2,y:14,'text-anchor':'middle',fill:activeChord?'#ffe28a':'#cad9eb','font-size':15,'font-weight':750},name);
    }
    add('text', {x:x(left)+5,y:11,fill:'#b9cde6','font-size':7}, 'Bar ' + label);
    for (let count = 0; count < pulses; count++) {
      const onset = anchor + group * bar + count * pulse;
      const a = Math.max(onset, windowStart), b = Math.min(onset + pulse, windowEnd);
      if (b <= a) continue;
      const cx = (x(a) + x(b)) / 2;
      const active = time >= a && time < b;
      const complete = time >= b;
      const mainBeat = count % subdivisions === 0;
      if (subdivisions > 1 && mainBeat && count > 0 && onset > windowStart)
        add('line', {x1:x(onset)-2,x2:x(onset)-2,y1:18,y2:46,stroke:'#54758c','stroke-dasharray':'2 2'});
      add('circle', {cx,cy:27,r:active?7:mainBeat?6:4,fill:complete?'#70e89a':active?'#ffd677':'#617c9b',
        stroke:active?'#fff0b0':'none','stroke-width':2,'data-state':complete?'done':active?'current':'remaining','data-pulse':count+1,'data-accent':mainBeat,'data-in-chord':onset < displayEnd && onset + pulse > displayStart});
      add('text', {x:cx,y:44,'text-anchor':'middle',fill:'#d5e3f3','font-size':9},count+1);
    }
  }
  const progress = Math.max(0,Math.min(1,(time-windowStart)/length));
  add('line', {x1:18,x2:18+650*progress,y1:50,y2:50,stroke:'#ffd677','stroke-width':2});
  add('text', {x:704,y:31,'text-anchor':'middle',fill:'#ffe28a','font-size':16,'font-weight':700}, '→ ' + (nextName || 'End'));
  graphic.append(svg);
  if (nextName) {
    const remaining = Math.max(0,(end-time)/pulse);
    $('stageSeconds').textContent = 'Change in ' + remaining.toFixed(1) + (subdivisions > 1 ? ' pulses' : ' beats');
  }
}
$('stageSyncBar').onpointerdown = () => { syncTapTime = audio.currentTime; };
$('stageSyncBar').onclick = async () => {
  const id = song?.id, rhythm = song?.rhythm;
  const firstDownbeat = syncTapTime ?? audio.currentTime;
  syncTapTime = null;
  if (syncingBar || !id || !rhythm || !rhythmBeats[rhythm.meter] || !Number.isFinite(firstDownbeat)) return;
  const audioVersion = song.audioVersion;
  syncingBar = true;
  const activePoint = SongRhythmPoints.at(rhythm, firstDownbeat)?.pointNumber;
  const editedRhythm = activePoint ? {...rhythm,points:rhythm.points.map((point,i)=>i===activePoint-1?{...point,time:firstDownbeat}:point)} : {...rhythm, firstDownbeat};
  song.rhythm = editedRhythm;
  showPlayingChord(audio.currentTime);
  $('stageSyncBar').textContent = 'Saving…';
  try {
    const result = await request(`/${id}/rhythm`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({audioVersion, rhythm: editedRhythm})
    });
    if (song?.id !== id || song.audioVersion !== audioVersion) return;
    song.rhythm = result.rhythm;
    songs = songs.map(item => item.id === id ? {...item, rhythm: result.rhythm} : item);
    $('stageSyncBar').textContent = '✓ Bar synced';
    status('Bar synced at ' + clock(firstDownbeat) + '. Beat 1 starts at your tap.');
  } catch (error) {
    if (song?.id === id && song.audioVersion === audioVersion) song.rhythm = rhythm;
    message(error);
  } finally {
    syncingBar = false;
    $('stageSyncBar').textContent = Number.isFinite(song?.rhythm?.firstDownbeat) ? '✓ Bar synced' : 'Bar starts now';
    showPlayingChord((takePlayback ?? audio).currentTime);
  }
};
$('stageSetRhythm').onclick = () => {
  const point = SongRhythmPoints.at(song?.rhythm, audio.currentTime)?.pointNumber;
  if(point) editRhythmPoint(point-1); else $('rhythmButton').click();
};
$('chordFocusToggle').onclick = () => {
  if (!chordFocus) focusPdfPoint = pagePoint();
  chordFocus = !chordFocus;
  $('chordFocusToggle').textContent = chordFocus ? 'PDF View' : 'Chord Focus';
  $('chordFocusToggle').setAttribute('aria-pressed', String(chordFocus));
  showPlayingChord((takePlayback ?? audio).currentTime);
  if (!chordFocus) {
    if (following) { activeCue = null; tick(); }
    else if (focusPdfPoint) restorePosition(0, focusPdfPoint.y, focusPdfPoint.x);
  }
};
$('stageBack').onclick = () => $('back').click();
$('stageForward').onclick = () => $('forward').click();
$('stagePlay').onclick = () => $('readerPlay').click();
$('stageStart').onclick = () => $('songStart').click();
$('stageSeek').oninput = () => {
  audio.currentTime = Number($('stageSeek').value);
  activeCue = null;
  tick();
};

function tick() {
  if (!song?.hasAudio || switchingTrack) return;
  const time = audio.currentTime;
  if (!takingSongRecording && !$('timelineEditorDialog').open && looping && loopA !== null && loopB !== null && !audio.paused && time >= loopB) {
    audio.currentTime = loopA; activeCue = null;
  }
  const player = takePlayback ?? audio;
  const now = player.currentTime;
  showPlayingChord(now);
  $('seek').max = Number.isFinite(player.duration) ? player.duration : song.duration;
  if (document.activeElement !== $('seek')) $('seek').value = now;
  $('clock').textContent = `${clock(now)} / ${clock(Number.isFinite(player.duration) ? player.duration : song.duration)}`;
  $('readerClock').textContent = $('clock').textContent;
  const cues = song.cues;
  let index = -1;
  for (let i = 0; i < cues.length; i++) { if (cues[i].time <= now) index = i; else break; }
  const cue = cues[index], nextCue = cues[index + 1];
  $('currentSection').textContent = cue?.label || (cues.length ? 'Before first cue' : 'No cue yet');
  $('nextSection').textContent = nextCue ? `Next: ${nextCue.label} at ${clock(nextCue.time)}` :
    cue ? 'Final saved section' : 'Move the PDF to a section, then tap Mark here.';
  if (window.AutoPdfFollow?.tick(now)) return;
  if (following) {
    if (activeCue !== index) {
      activeCue = index;
      seekPdf(cue);
    }
    scrollBetweenCues(cue, nextCue, now);
  }
}
const songToolDialogs = new Set([
  'pdfSyncDialog', 'analyzeChordsDialog', 'rhythmDialog', 'rhythmPointsDialog', 'chordMatchDialog', 'recordReviewDialog',
  'replacePdfDialog', 'deleteSongDialog', 'timelineEditorDialog', 'timingCalibrationDialog'
]);
function dismissDialog(id) {
  closeDialog(id);
  if(id === 'rhythmDialog' && rhythmPointTime !== null) { openRhythmPoints(); return; }
  if (song && songToolDialogs.has(id)) openDialog('toolsDialog');
}
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => { if (!busy) dismissDialog(button.dataset.close); };
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => {
    if(dialog.id==='notesDialog'){event.preventDefault();if(!busy)requestNotesClose();return;}
    if (busy) event.preventDefault();
    else if (song && songToolDialogs.has(dialog.id)) {
      event.preventDefault();
      dismissDialog(dialog.id);
    }
  });
});
$('libraryButton').onclick = () => operation(async () => { await refreshLibrary();renderLibrary();openDialog('libraryDialog'); });
$('search').oninput = renderLibrary;
for(let capo=1;capo<=12;capo++)$('importCapo').add(new Option('Fret '+capo,capo));
$('importCapo').onchange=()=>{$('importCapo').dataset.changed='true';};
function importDialog() { $('importCapo').value='0';$('importCapo').dataset.changed='false';closeDialog('libraryDialog'); closeDialog('toolsDialog'); $('importStatus').textContent = ''; openDialog('importDialog'); }
$('importButton').onclick = importDialog; $('libraryImport').onclick = importDialog;
$('doImport').onclick = () => operation(async () => {
  const files = [...$('pdfFiles').files], selection = audioSelection($('importAudio').files);
  if (!files.length) throw new Error('Choose at least one PDF.');
  if (selection && files.length !== 1) throw new Error('Attach an MP3 when importing one PDF, or import PDFs only.');
  const importOptions={capo:Number($('importCapo').value),capoExplicit:$('importCapo').dataset.changed==='true',analyze:$('importAnalyze').checked};
  let last;const notices=[];
  const existingIds = new Set(songs.map(item => item.id));
  let replacedExisting=false;
  for (const file of files) {
    const progress=text=>{$('importStatus').textContent=file.name+' · '+text;status($('importStatus').textContent);};
    progress('Importing PDF…');last=await uploadPdf(file);replacedExisting=existingIds.has(last.id);
    if(selection){progress('Attaching selected recording…');last=await uploadAudioSelection(last.id,selection);if(last.backingImportMessage)notices.push(last.backingImportMessage);}
    const setup=await window.SongImportSetup.run(last,{...importOptions,existing:replacedExisting},progress);
    last=setup.item;notices.push(...setup.notices);existingIds.add(last.id);
  }
  await refreshLibrary();
  closeDialog('importDialog'); $('pdfFiles').value = ''; $('importAudio').value = '';
  last=songs.find(item=>item.id===last.id)||last;
  selectSong(last);
  const summary = files.length === 1 && replacedExisting
    ? 'Existing song updated. Kept ' + last.cues.length + ' Follow cues. Check their positions on the new PDF.'
    : 'Imported and saved on this Pi.';
  status(audioSavedStatus(last, summary)+' '+[...new Set(notices)].join(' '));
});
$('replacePdfButton').onclick = () => {
  closeDialog('toolsDialog');
  $('replacementPdf').value = '';
  $('replaceSongTitle').textContent = song.title;
  openDialog('replacePdfDialog');
};
$('confirmReplacePdf').onclick = () => operation(async () => {
  const file = $('replacementPdf').files[0];
  if (!file || !song) throw new Error('Choose the new PDF first.');
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Choose a PDF file.');
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF files are limited to 20 MB.');
  audio.pause(); status('Checking and replacing PDF…');
  const previousCues = song.cues.length;
  const updated = await request(`/${song.id}/pdf?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file
  });
  await refreshLibrary();
  selectSong(updated);
  closeDialog('replacePdfDialog'); $('replacementPdf').value = '';
  status(previousCues && !updated.cues.length
    ? 'PDF replaced. Audio and notes kept. Mark Follow positions for the new PDF.'
    : 'PDF saved. Audio and notes kept.');
});
$('deleteSongButton').onclick = () => {
  closeDialog('toolsDialog');
  $('deleteSongTitle').textContent = song.title;
  $('deleteSongDetails').textContent = `${song.pages} pages · ${song.audioName || 'No MP3'} · ${song.cues.length} cues`;
  openDialog('deleteSongDialog');
};
$('confirmDeleteSong').onclick = () => operation(async () => {
  const title = song.title;
  await request(`/${song.id}`, { method: 'DELETE' });
  switchToken++; switchingTrack = false;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  pageToken++; pageReady = false; pendingCue = null; song = null; alternatePdf = pairedPdf = null;
  window.GuitarChordViewer?.reset(null);
  page = 1; audioVariant = 'original'; loopA = loopB = null; looping = false;
  setFollow(false);
  const image = $('pdfImage');
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  image.removeAttribute('src'); image.hidden = true;
  $('emptySheet').hidden = false; $('pageLoading').hidden = true;
  $('seek').value = 0;
  $('clock').textContent = $('readerClock').textContent = '0:00 / 0:00';
  $('currentSection').textContent = 'No cue yet';
  $('nextSection').textContent = 'Choose a song to continue.';
  try { localStorage.removeItem('guitar-last-song'); } catch {}
  closeDialog('deleteSongDialog');
  await refreshLibrary();
  $('search').value = ''; renderLibrary(); openDialog('libraryDialog');
  status(`Deleted “${title}” from the library.`);
});
$('audioButton').onclick = () => { closeDialog('toolsDialog'); $('audioFile').click(); };
$('audioFile').onchange = () => operation(async () => {
  const selection = audioSelection($('audioFile').files); if (!selection || !song) return;
  if (song.hasAudio && !confirm('A different original recording clears timing cues and its backing link. Reattaching the exact same file preserves them. Continue?')) return;
  audio.pause(); status('Saving MP3…');
  const updated = await uploadAudioSelection(song.id, selection);
  await refreshLibrary(); selectSong(updated);
  status(audioSavedStatus(updated, 'MP3 saved.'));
  $('audioFile').value = '';
});
$('addBacking').onclick = () => { closeDialog('toolsDialog'); $('backingFile').click(); };
$('backingFile').onchange = () => operation(async () => {
  const file = $('backingFile').files[0];
  if (!file || !song?.hasAudio) return;
  const playing = !audio.paused;
  audio.pause(); status('Checking and saving backing track…');
  try {
    const result = await uploadAudio(song.id, file, 'backing');
    song = result; songs = songs.map(item => item.id === result.id ? result : item);
    renderLibrary();
    // If replacing a backing already in use, reload the new backing at the same time.
    if (audioVariant === 'backing') audioVariant = 'original';
    await switchTrack('backing', playing);
  } finally { $('backingFile').value = ''; }
});
$('simpleVersion').onchange = () => {
  if (!song || !pairedPdf || busy) return;
  const previousAnalysis = activeChordAnalysis();
  const point = pagePoint();
  pendingPageX = point.x;
  alternatePdf = $('simpleVersion').checked === isSimplePdf(song) ? null : pairedPdf;
  const pdf = alternatePdf || song;
  pageReady = false;
  activeCue = null;
  window.GuitarChordViewer?.reset(song.id);
  if (activeChordAnalysis() !== previousAnalysis) window.SongChordMatch?.stop();
  stageDiagramName = '';
  showPlayingChord(audio.currentTime);
  status(isSimplePdf(pdf) ? 'Simple version' : 'Standard version');
  if (following && !switchingTrack) tick();
  else renderPage(page, 0, point.y);
};
$('previous').onclick = () => { if (!takingSongRecording) setFollow(false); renderPage(page - 1); };
$('next').onclick = () => { if (!takingSongRecording) setFollow(false); renderPage(page + 1); };
function changeZoom(delta) {
  if (!pageReady) return;
  const point = pagePoint();
  zoom = Math.max(1, Math.min(3, +(zoom + delta).toFixed(2)));
  preferredZoom = zoom;
  try { localStorage.setItem('guitar-reading-zoom', String(zoom)); } catch {}
  $('pdfImage').style.width = `${zoom * 100}%`;
  restorePosition(0, point.y, point.x);
  update();
}
$('zoomIn').onclick = () => changeZoom(0.25); $('zoomOut').onclick = () => changeZoom(-0.25);
for (const event of ['pointerdown', 'wheel', 'keydown']) $('pdfViewport').addEventListener(event, input => {
  if (input.type === 'pointerdown' && input.target.closest('.chordtarget')) return;
  if (following && !takingSongRecording) { setFollow(false); status('Manual PDF navigation. Tap Follow on to resume cues.'); }
}, { passive: true });
$('follow').onclick = () => {
  const autoMode=window.AutoPdfFollow?.state();
  if(autoMode?.enabled){if(autoMode.suspended)window.AutoPdfFollow.resume();else window.AutoPdfFollow.pause();return;}
  if (!song.cues.length) { status('First mark a section at its recording time.'); return; }
  setFollow(!following); tick();
};
$('markCue').onclick = mark; $('cueMark').onclick = mark;
$('cuesButton').onclick = () => { renderCues(); openDialog('cueDialog'); };
$('cuePart').onchange = () => {
  $('customCueLabel').hidden = $('cuePart').value !== 'custom';
};
$('saveCue').onclick = () => operation(async () => {
  if (!pendingCue) return;
  pendingCue.label = $('cuePart').value === 'custom'
    ? $('cueName').value.trim() || `Section ${song.cues.length + 1}` : $('cuePart').value;
  const next = [...song.cues.filter(cue => Math.abs(cue.time - pendingCue.time) >= 0.25), pendingCue];
  await saveSettings({ cues: next }); activeCue = null; pendingCue = null;
  closeDialog('markDialog'); renderCues(); status('Cue saved. Follow turns on when playback starts.');
});
let noteImageIndex=0,notesExpectedUpdated=null,notesOriginal=null;
function notesEditing(enabled){for(const id of ['titleInput','notesInput']){const field=$(id);field.readOnly=!enabled;field.inputMode=enabled?'text':'none';field.tabIndex=enabled?0:-1;} $('saveNotes').hidden=enabled===false;$('editNotes').hidden=enabled;}
function notesDirty(){return notesOriginal&&($('titleInput').value!==notesOriginal.title||$('notesInput').value!==notesOriginal.notes);}
function requestNotesClose(){if(busy)return;if(notesDirty())openDialog('notesUnsavedDialog');else{notesEditing(false);dismissDialog('notesDialog');}}
$('editNotes').onclick=()=>{notesEditing(true);$('notesInput').focus();};
$('closeNotes').onclick=requestNotesClose;
$('keepEditingNotes').onclick=()=>closeDialog('notesUnsavedDialog');
$('discardNotes').onclick=()=>{closeDialog('notesUnsavedDialog');notesEditing(false);dismissDialog('notesDialog');};
function showNotesTab(tab){
 for(const name of ['Notes','Images']){$('notesTab'+name).setAttribute('aria-selected',String(name===tab));$('notesPanel'+name).hidden=name!==tab;}
}
function renderNoteImage(){
 const images=[...(song?.images||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||'',undefined,{numeric:true,sensitivity:'base'}));noteImageIndex=Math.max(0,Math.min(noteImageIndex,images.length-1));const image=images[noteImageIndex];
 $('songNoteImage').hidden=!image;$('songNoteImageEmpty').hidden=Boolean(image);
 if(image){$('songNoteImage').src=api+'/'+song.id+'/images/'+image.id;$('songNoteImage').alt=image.name||'Song reference image';}else $('songNoteImage').removeAttribute('src');
 $('noteImageCount').textContent=image?(noteImageIndex+1)+' / '+images.length+' · '+image.name:'No images';
 $('noteImagePrev').disabled=!image||noteImageIndex===0;$('noteImageNext').disabled=!image||noteImageIndex===images.length-1;
}
for(const name of ['Notes','Images'])$('notesTab'+name).onclick=()=>showNotesTab(name);
$('noteImagePrev').onclick=()=>{noteImageIndex--;renderNoteImage();};$('noteImageNext').onclick=()=>{noteImageIndex++;renderNoteImage();};
$('notesButton').onclick = () => operation(async () => {
  const selectedId=song.id;const latest=(await request()).find(item=>item.id===selectedId);
  if(!latest||song.id!==selectedId)throw Error('Select this song again before opening its notes.');
  song.notes=latest.notes;song.lessonUrl=latest.lessonUrl;song.images=latest.images||[];song.title=latest.title;notesExpectedUpdated=latest.updated;
  closeDialog('toolsDialog');
  $('titleInput').value = song.title; $('notesInput').value = song.notes||'';notesOriginal={title:$('titleInput').value,notes:$('notesInput').value};notesEditing(false); $('notesWatchLesson').hidden=!song.lessonUrl;$('notesLessonEmpty').hidden=Boolean(song.lessonUrl);noteImageIndex=0;renderNoteImage();showNotesTab('Notes');openDialog('notesDialog');
});
$('readerNotes').onclick=()=>$('notesButton').click();
$('readerChordMatch').onclick=()=>$('chordMatchButton').click();
$('notesWatchLesson').onclick=()=>{if(song?.lessonUrl)LessonLinks.open(song.lessonUrl,status);};
$('saveNotes').onclick = $('saveAndCloseNotes').onclick = () => operation(async () => {
  await saveSettings({ title: $('titleInput').value, notes: $('notesInput').value, expectedUpdated: notesExpectedUpdated });
  notesOriginal={title:$('titleInput').value,notes:$('notesInput').value};closeDialog('notesUnsavedDialog');notesEditing(false);dismissDialog('notesDialog'); status('Song notes saved on this Pi.');
});
$('play').onclick = () => {
  if (audio.paused) startSongPlayback().catch(message); else audio.pause();
};
$('back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 5); activeCue = null; tick(); };
$('forward').onclick = () => { audio.currentTime = Math.min(song.duration, audio.currentTime + 5); activeCue = null; tick(); };
function seekSong(time) {
  audio.currentTime = time;
  activeCue = null;
  tick();
}
$('songStart').onclick = () => {
  cancelSongStart();
  audio.pause();
  seekSong(0);
  startSongPlayback().catch(message);
};
$('seek').oninput = () => seekSong(Number($('seek').value));
$('speed').onchange = () => {
  audio.playbackRate = Number($('speed').value);
  $('speedLabel').textContent = $('speed').value + '×';
};
$('setA').onclick = () => {
  loopA = audio.currentTime;
  if (loopB !== null && loopB <= loopA + 0.5) { loopB = null; looping = false; }
  update();
};
$('setB').onclick = () => {
  if (loopA === null) { status('Set A at the start of the passage first.'); return; }
  if (audio.currentTime <= loopA + 0.5) { status('Set B at least half a second after A.'); return; }
  loopB = audio.currentTime; update();
};
$('loop').onclick = () => {
  looping = !looping;
  if (looping && (audio.currentTime < loopA || audio.currentTime >= loopB)) audio.currentTime = loopA;
  activeCue = null; update(); tick();
};
const rhythmBeats = {'2/4': 2, '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 2, '7/4': 7, '9/8': 3, '12/8': 4};
let rhythmDraft = null, rhythmPointTime = null, rhythmAudioVersion = '', rhythmContext, rhythmClicks = [];
let previewVersion = 0, previewing = false;
const rhythmStatus = text => { $('rhythmStatus').textContent = text; };
function updateBeatUnit() {
  $('rhythmBeatUnit').textContent = $('rhythmMeter').value.endsWith('/8')
    ? 'BPM counts dotted-quarter beats, with three eighth notes per beat.'
    : 'BPM counts quarter-note beats.';
}
function fillRhythm(rhythm) {
  rhythmDraft = rhythm;
  $('rhythmBpm').value = rhythm?.bpm ?? '';
  $('rhythmMeter').value = rhythm?.meter ?? '';
  updateBeatUnit();
}
function stopRhythmClicks() {
  previewVersion++;
  previewing = false;
  for (const click of rhythmClicks) click.stop();
  rhythmClicks = [];
  $('previewRhythm').textContent = 'Preview clicks';
}
$('rhythmButton').onclick = () => {
  rhythmAudioVersion = song.audioVersion;
  rhythmPointTime = null;
  $('rhythmTitle').textContent = 'Song rhythm';
  fillRhythm(song.rhythm);
  rhythmStatus(song.rhythm ? 'Saved for this recording.' : '');
  closeDialog('toolsDialog');
  openDialog('rhythmDialog');
};
$('rhythmDialog').addEventListener('close', stopRhythmClicks);
$('rhythmMeter').onchange = updateBeatUnit;
$('analyzeRhythm').onclick = () => operation(async () => {
  stopRhythmClicks();
  rhythmStatus('Analyzing up to 90 seconds of the original MP3…');
  try {
    const {estimate, audioVersion} = await request(`/${song.id}/rhythm/analyze`, { method: 'POST' });
    rhythmAudioVersion = audioVersion;
    const chosenMeter = $('rhythmMeter').value;
    fillRhythm(estimate);
    if (!estimate.meter && chosenMeter) {
      $('rhythmMeter').value = chosenMeter;
      updateBeatUnit();
    }
    rhythmStatus(estimate.meter
      ? `Estimated ${estimate.meter} · ${estimate.bpm} BPM. Confirm by ear before saving.`
      : `Estimated ${estimate.bpm} BPM. Time signature unclear. Choose or keep a time signature, then preview. Use ½ or 2× tempo if the clicks feel too fast or slow.`);
  } catch (error) { rhythmStatus(error.message); }
});
let rhythmTaps = [], rhythmTapIntervals = [], rhythmTapDown = null, rhythmTapCount = 0;
$('tapRhythmTempo').onpointerdown = event => {
  if (event.isPrimary && event.button === 0) rhythmTapDown = performance.now();
};
$('tapRhythmTempo').onpointercancel = () => { rhythmTapDown = null; };
$('tapRhythmTempo').onclick = () => {
  const now = rhythmTapDown ?? performance.now();
  rhythmTapDown = null;
  if (rhythmTaps.length && now - rhythmTaps.at(-1) < 150) return;
  const perBar = $('rhythmTapUnit').value === 'bar';
  const beatsPerTap = perBar ? rhythmBeats[$('rhythmMeter').value] : 1;
  if (!beatsPerTap) {
    rhythmStatus('Choose the time signature first, then tap beat 1 of each bar.');
    return;
  }
  const timeout = perBar ? beatsPerTap * 2000 + 500 : 2200;
  const fresh = !rhythmTaps.length || now - rhythmTaps.at(-1) > timeout;
  if (fresh) { rhythmTaps = []; rhythmTapIntervals = []; rhythmTapCount = 0; }
  const gap = rhythmTaps.length ? now-rhythmTaps.at(-1) : null;
  if (rhythmTapIntervals.length >= 1) {
    const sorted = rhythmTapIntervals.slice(-8).sort((a,b)=>a-b);
    const middle = Math.floor(sorted.length/2);
    const typical = sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
    if (Math.abs(gap-typical) > typical*.25) {
      // Move the anchor for a long/missed tap, but do not average that gap.
      // Keep the old anchor for an early extra tap so the next real beat works.
      const skipped = Math.round(gap/typical);
      if (skipped >= 2 && Math.abs(gap/skipped-typical) <= typical*.15)
        rhythmTaps[rhythmTaps.length-1] = now;
      rhythmStatus('Off-beat tap ignored. Keep tapping steadily; pause to start a new tempo.');
      return;
    }
  }
  if (gap !== null) rhythmTapIntervals.push(gap);
  rhythmTaps.push(now);
  rhythmTapCount++;
  const button = $('tapRhythmTempo');
  if (rhythmTaps.length < 2) {
    button.textContent = 'Tap 1 · tap again';
    rhythmStatus(perBar ? 'Tap 1 received. Tap again on beat 1 of the NEXT bar.' : 'First tap received. Tap again on the next main beat.');
    return;
  }
  const interval = rhythmTapIntervals.reduce((sum,gap)=>sum+gap,0)/rhythmTapIntervals.length;
  const bpm = 60000 * beatsPerTap / interval;
  if (bpm < 30 || bpm > 300) {
    button.textContent = 'Tap beat again';
    rhythmStatus(perBar ? 'Tap once per bar. Choose the correct time signature first.' : 'Tap a steady beat between 30 and 300 BPM. In 6/8 tap on 1 and 4.');
    rhythmTaps = [now]; rhythmTapIntervals = []; rhythmTapCount = 1;
    return;
  }
  stopRhythmClicks();
  const rounded = Math.round(bpm * 10) / 10;
  $('rhythmBpm').value = rounded;
  $('rhythmBpm').dispatchEvent(new Event('input', {bubbles:true}));
  button.textContent = 'Tap ' + rhythmTapCount + ' · ' + rounded + ' BPM';
  rhythmStatus((perBar ? 'One tap per bar' : 'One tap per beat') + ' · average of ' + rhythmTapIntervals.length + ' intervals: ' + (interval / 1000).toFixed(2)
    + ' s → ' + rounded + ' BPM. Save rhythm when steady.');
};
$('rhythmTapUnit').onchange = () => {
  rhythmTaps = []; rhythmTapIntervals = []; rhythmTapCount = 0; rhythmTapDown = null;
  $('tapRhythmTempo').textContent = $('rhythmTapUnit').value === 'bar' ? 'Tap beat 1' : 'Tap beat';
  rhythmStatus($('rhythmTapUnit').value === 'bar' ? 'Tap beat 1 of two consecutive bars.' : 'Tap on each main beat. In 6/8 tap on 1 and 4.');
};
$('rhythmMeter').addEventListener('change', () => { rhythmTaps = []; rhythmTapIntervals = []; rhythmTapCount = 0; rhythmTapDown = null; });
$('rhythmDialog').addEventListener('close', () => {
  rhythmTaps = []; rhythmTapIntervals = []; rhythmTapCount = 0; rhythmTapDown = null;
  $('tapRhythmTempo').textContent = $('rhythmTapUnit').value === 'bar' ? 'Tap beat 1' : 'Tap beat';
});
for (const [id, factor] of [['halfRhythmTempo', .5], ['doubleRhythmTempo', 2]]) {
  $(id).onclick = () => {
    const bpm = $('rhythmBpm').valueAsNumber * factor;
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
      rhythmStatus('Tempo must be between 30 and 300 BPM.');
      return;
    }
    stopRhythmClicks();
    $('rhythmBpm').value = Math.round(bpm * 10) / 10;
    rhythmStatus('Tempo adjusted. Preview the clicks before saving.');
  };
}
$('previewRhythm').onclick = async () => {
  if (previewing) {
    stopRhythmClicks();
    rhythmStatus('Click preview stopped.');
    return;
  }
  if (!$('rhythmForm').reportValidity()) return;
  const version = ++previewVersion;
  previewing = true;
  $('previewRhythm').textContent = 'Stop clicks';
  try {
    rhythmContext ??= new AudioContext();
    await rhythmContext.resume();
    if (version !== previewVersion || !$('rhythmDialog').open) return;
    const bpm = $('rhythmBpm').valueAsNumber, beats = rhythmBeats[$('rhythmMeter').value];
    const subdivisions = $('rhythmMeter').value.endsWith('/8') ? 3 : 1;
    const pulsesPerBar = beats * subdivisions;
    const playing = !audio.paused;
    const rate = playing ? audio.playbackRate : 1;
    const pulse = 60 / (bpm * subdivisions);
    const aligned = playing && bpm === rhythmDraft?.bpm && $('rhythmMeter').value === rhythmDraft?.meter
      && Number.isFinite(rhythmDraft.firstDownbeat);
    const lead = .05;
    const playhead = audio.currentTime;
    const firstPulse = aligned ? Math.ceil((playhead + lead * rate - rhythmDraft.firstDownbeat) / pulse) : 0;
    const delay = aligned ? (rhythmDraft.firstDownbeat + firstPulse * pulse - playhead) / rate : lead;
    const start = rhythmContext.currentTime + delay;
    rhythmStatus(aligned ? 'Playing two bars over the song, aligned to the estimated beat.'
      : playing ? 'Playing two bars over the song. The clicks start from your tap.'
      : 'Playing two bars of clicks.');
    for (let index = 0; index < pulsesPerBar * 2; index++) {
      const time = start + index * pulse / rate;
      const accent = (firstPulse + index) % pulsesPerBar === 0;
      const mainBeat = (firstPulse + index) % subdivisions === 0;
      const click = rhythmContext.createOscillator(), gain = rhythmContext.createGain();
      click.frequency.value = accent ? 1250 : mainBeat ? 850 : 650;
      gain.gain.setValueAtTime(accent ? .16 : mainBeat ? .08 : .04, time);
      gain.gain.exponentialRampToValueAtTime(.001, time + .045);
      click.connect(gain).connect(rhythmContext.destination);
      rhythmClicks.push(click);
      click.onended = () => {
        click.disconnect();
        gain.disconnect();
        if (version !== previewVersion) return;
        rhythmClicks = rhythmClicks.filter(node => node !== click);
        if (!rhythmClicks.length) {
          stopRhythmClicks();
          rhythmStatus('Click preview finished.');
        }
      };
      click.start(time); click.stop(time + .05);
    }
  } catch {
    if (version !== previewVersion) return;
    stopRhythmClicks();
    rhythmStatus('Could not play the click preview.');
  }
};
$('rhythmForm').onsubmit = event => {
  event.preventDefault();
  stopRhythmClicks();
  operation(async () => {
    const bpm = $('rhythmBpm').valueAsNumber, meter = $('rhythmMeter').value;
    const firstDownbeat = bpm === rhythmDraft?.bpm && meter === rhythmDraft?.meter ? rhythmDraft.firstDownbeat : null;
    const rhythm = rhythmPointTime === null ? {bpm,meter,firstDownbeat,points:song.rhythm?.points||[]}
      : {...song.rhythm,points:(song.rhythm?.points||[]).map(point=>point.time===rhythmPointTime?{...point,bpm,meter}:point)};
    try {
      const result = await request(`/${song.id}/rhythm`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({audioVersion: rhythmAudioVersion, rhythm})
      });
      songs = songs.map(item => item.id === result.id ? result : item);
      song = result;
      fillRhythm(rhythmPointTime === null ? song.rhythm : {...song.rhythm.points.find(point=>point.time===rhythmPointTime),firstDownbeat:rhythmPointTime});
      showPlayingChord(audio.currentTime);
      rhythmStatus('Rhythm saved for this recording.');
    } catch (error) { rhythmStatus(error.message); }
  });
};
for (let shift = -12; shift <= 12; shift++) {
  const label = shift === 0 ? '0 · Same key' : shift > 0 ? '+' + shift : String(shift);
  $('chordAnalysisShift').add(new Option(label, shift));
}
$('analyzeChordsButton').onclick = () => {
  audio.pause();
  closeDialog('toolsDialog');
  $('chordAnalysisShift').value = activeChordAnalysis()?.shift ?? 0;
  $('chordAnalysisStatus').textContent = activeChordAnalysis()
    ? 'A chord estimate is saved. Analyze again to change the pitch shift.'
    : 'Ready. Analysis may take a minute on the Pi.';
  openDialog('analyzeChordsDialog');
};
$('runChordAnalysis').onclick = () => operation(async () => {
  if(activeChordAnalysis()?.corrected && !confirm('Analyzing again replaces your saved chord corrections. Continue?')) return;
  const owner = song;
  const {id, variant, pdf} = analysisTarget();
  $('chordAnalysisStatus').textContent = 'Analyzing the original MP3 using the displayed PDF…';
  try {
    const result = await request(`/${id}/analyze-chords`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({shift: Number($('chordAnalysisShift').value), variant})
    });
    window.SongChordMatch?.stop();
    if (song !== owner) return;
    if (variant === 'simple') song.simpleChordAnalysis = result;
    else pdf.chordAnalysis = result;
    songs = songs.map(item => item.id === id ? {...item, chordAnalysis: variant ? item.chordAnalysis : result, simpleChordAnalysis: variant ? result : item.simpleChordAnalysis} : item);
    showPlayingChord(audio.currentTime);
    const matches = result.changes.filter(change => change.name);
    const detected = [...new Set(matches.map(change => change.name))];
    $('chordAnalysisStatus').textContent = matches.length
      ? `Saved ${matches.length} estimated chord sections. Detected: ${detected.join(', ')}.`
      : 'No clear chord matches. Check the pitch shift and try again.';
  } catch (error) { $('chordAnalysisStatus').textContent = error.message; }
});
const toolTabs = [...$('toolsDialog').querySelectorAll('[role="tab"]')];
let currentToolTab = toolTabs[0];
function selectToolTab(tab) {
  currentToolTab = tab;
  for (const item of toolTabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !selected;
  }
}
for (const [index, tab] of toolTabs.entries()) {
  tab.onclick = () => selectToolTab(tab);
  tab.onkeydown = event => {
    const offset = {ArrowLeft: -1, ArrowRight: 1}[event.key];
    const next = event.key === 'Home' ? toolTabs[0] : event.key === 'End' ? toolTabs.at(-1)
      : offset ? toolTabs[(index + offset + toolTabs.length) % toolTabs.length] : null;
    if (!next) return;
    event.preventDefault();
    selectToolTab(next);
    next.focus();
  };
}
function showTools(tab = currentToolTab) {
  selectToolTab(tab);
  openDialog('toolsDialog');
}
$('toolsButton').onclick = $('readerTools').onclick = () => showTools();
$('loopTools').onclick = () => showTools($('toolsTabPlayback'));
$('readerPlay').onclick = $('play').onclick;
$('readerBack').onclick = $('back').onclick;
$('readerForward').onclick = $('forward').onclick;
$('readerLoop').onclick = $('loop').onclick;
$('toolsLoopToggle').onclick=()=>$('loop').click();
$('toolsBack').onclick=()=>$('back').click();$('toolsForward').onclick=()=>$('forward').click();
$('stageTrack').onclick = $('trackToggle').onclick = $('readerTrack').onclick = () => switchTrack(audioVariant === 'original' ? 'backing' : 'original');
$('originalTrack').onclick = () => switchTrack('original');
$('backingTrack').onclick = () => switchTrack('backing');
$('clearLoop').onclick = () => { loopA = loopB = null; looping = false; update(); };
function syncReaderControls() {
  document.body.classList.toggle('clean-song', cleanSongLayout);
  document.body.classList.toggle('controls-open',readerControlsOpen);
  $('cleanSongLayout').checked=cleanSongLayout;
  document.body.classList.toggle('reader', readerMode);
  document.body.classList.toggle('reader-controls-collapsed', readerMode && !readerControlsOpen);
  $('readerPageControls').hidden = readerMode && !readerControlsOpen;
  $('readerControls').hidden = (readerMode || cleanSongLayout) && !readerControlsOpen;
  const toggle = $('readerControlsToggle');
  toggle.hidden = $('readerBottom').hidden = !(readerMode || cleanSongLayout);
  toggle.setAttribute('aria-expanded', String(readerControlsOpen));
  toggle.textContent = readerControlsOpen ? '▾ Hide controls' : '▴ Controls';
  toggle.setAttribute('aria-label', readerControlsOpen ? 'Hide controls' : 'Show controls');
  showPlayingChord((takePlayback ?? audio).currentTime);
}
function setReaderMode(value) {
  const point = pagePoint();
  readerMode = value;
  readerControlsOpen = false;
  syncReaderControls();
  try { localStorage.setItem('guitar-reading-view', readerMode ? 'full' : 'split'); } catch {}
  restorePosition(0, point.y, point.x);
  update();
}
$('readerToggle').onclick = () => setReaderMode(!readerMode);
$('readerControlsToggle').onclick = () => {
  const point = pagePoint();
  readerControlsOpen = !readerControlsOpen;
  syncReaderControls();
  restorePosition(0, point.y, point.x);
};
$('cleanSongLayout').onchange = () => {cleanSongLayout=$('cleanSongLayout').checked;readerMode=false;chordFocus=false;focusPdfPoint=null;$('chordFocusToggle').textContent='Chord Focus';$('chordFocusToggle').setAttribute('aria-pressed','false');readerControlsOpen=false;try{localStorage.setItem('guitar-clean-song-layout',String(cleanSongLayout));localStorage.setItem('guitar-reading-view','split');}catch{}syncReaderControls();update();};
syncReaderControls();
audio.addEventListener('play', () => {
  if (isRecordingFollow()) { update(); return; }
  if (!switchingTrack) {
    pendingPageX = songStartEdge();
    scrollPdfHorizontally(pendingPageX);
  }
  setFollow(Boolean(song?.cues.length));
  tick();
});
audio.addEventListener('pause', update);
audio.addEventListener('loadedmetadata', () => { audio.preservesPitch = true; tick(); });
audio.addEventListener('ended', () => {
  if (isRecordingFollow()) { stopRecordingFollow(); return; }
  if (!$('timelineEditorDialog').open && looping && loopA !== null) { audio.currentTime = loopA; audio.play().catch(message); }
  update();
});
audio.addEventListener('error', () => { if (!switchingTrack && audio.getAttribute('src')) status('Could not play this MP3. Try attaching another recording.'); });
setInterval(tick, 100);
update();
refreshLibrary().then(() => {
  let last; try { last = localStorage.getItem('guitar-last-song'); } catch {}
  const item = songs.find(s => s.id === last);
  if (item) selectSong(item); else { status('Choose a song or import a PDF.'); openDialog('libraryDialog'); }
}).catch(error => { message(error); openDialog('libraryDialog'); });

$('watchLesson').onclick = () => {
  if (!song) return;
  if (song.lessonUrl) LessonLinks.open(song.lessonUrl, status);
};

let rhythmPointTap = null;
async function saveRhythmPoints(rhythm) {
  const owner = song, id = owner.id;
  const result = await request(`/${id}/rhythm`, {method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({audioVersion:owner.audioVersion,rhythm})});
  songs = songs.map(item=>item.id===id?result:item);
  if (song !== owner) return;
  song.rhythm = result.rhythm;
  renderRhythmPoints(); showPlayingChord(audio.currentTime);
}
function renderRhythmPoints() {
  const list = $('rhythmPointsList'); list.replaceChildren();
  const points = song?.rhythm?.points || [];
  if (!points.length) list.textContent = 'No rhythm points yet. Play the song and mark beat 1.';
  points.forEach((point,index)=>{
    const row = document.createElement('div'); row.className='rhythm-point-row';
    const label = document.createElement('strong');
    label.textContent = `#${index+1} · ${clock(point.time)} · ${point.bpm} BPM · ${point.meter}`;
    row.append(label);
    for (const [name,action] of [
      ['Go',()=>{audio.currentTime=point.time;showPlayingChord(point.time);}],
      ['Edit',()=>editRhythmPoint(index)],
      ['Delete',()=>operation(()=>saveRhythmPoints({...song.rhythm,points:song.rhythm.points.filter(item=>item.time!==point.time)}))]
    ]) {const button=document.createElement('button');button.textContent=name;button.onclick=action;row.append(button);}
    list.append(row);
  });
}
function editRhythmPoint(index){
  const point=song.rhythm.points[index];
  audio.pause();closeDialog('rhythmPointsDialog');rhythmPointTime=point.time;rhythmAudioVersion=song.audioVersion;
  $('rhythmTitle').textContent='#'+(index+1)+' rhythm';fillRhythm({...point,firstDownbeat:point.time});
  rhythmStatus('Tempo and meter apply from this point until the next.');openDialog('rhythmDialog');
}
audio.addEventListener('timeupdate',()=>{if($('rhythmPointsDialog').open)$('pointClock').textContent=clock(audio.currentTime);});
function openRhythmPoints(){closeDialog('rhythmDialog');renderRhythmPoints();$('pointClock').textContent=clock(audio.currentTime);openDialog('rhythmPointsDialog');}
$('rhythmPointsButton').onclick=openRhythmPoints;
for(const id of ['addRhythmPoint','markRhythmPoint']) {
  $(id).onpointerdown=()=>{rhythmPointTap=audio.currentTime;};
  $(id).onpointercancel=()=>{rhythmPointTap=null;};
  $(id).onclick=()=>{
    const time=rhythmPointTap??audio.currentTime;rhythmPointTap=null;
    if(!song?.rhythm){status('Set the song tempo and meter first.');return;}
    operation(async()=>{await saveRhythmPoints(SongRhythmPoints.put(song.rhythm,time));status('Rhythm point saved at '+clock(time));});
  };
}
$('pointPlay').onclick=()=>{if(audio.paused)startSongPlayback().catch(message);else audio.pause();};
