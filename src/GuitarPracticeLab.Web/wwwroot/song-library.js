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
  for (const prefix of ['song', 'reader']) {
    $(prefix + 'Volume').value = percentage;
    $(prefix + 'Volume').setAttribute('aria-valuetext', percentage + ' percent' + (silent ? ', muted' : ''));
    $(prefix + 'VolumeValue').textContent = percentage + '%';
    const mute = $(prefix + 'Mute');
    mute.textContent = silent ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-label', silent ? 'Unmute song' : 'Mute song');
    mute.setAttribute('aria-pressed', String(silent));
  }
  try {
    localStorage.setItem('guitar-song-volume', JSON.stringify({
      volume: audio.volume, muted: audio.muted, lastAudible: lastAudibleVolume
    }));
  } catch {}
}
for (const prefix of ['song', 'reader']) {
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
let preferredZoom = 1.5, readerMode = false;
try {
  const saved = Number(localStorage.getItem('guitar-reading-zoom'));
  if (saved >= 1 && saved <= 3) preferredZoom = saved;
  readerMode = localStorage.getItem('guitar-reading-view') === 'full';
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
      dialog.querySelector('.dialogbody').prepend(alert);
    }
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
    update();
  } catch {
    // The standard PDF remains usable if the companion lookup fails.
  }
}
function update() {
  const pdf = alternatePdf || song;
  $('simpleVersionControl').hidden = !pairedPdf;
  $('simpleVersion').checked = !!pdf && isSimplePdf(pdf);
  $('simpleVersion').disabled = busy;
  $('chordListButton').disabled = $('watchLesson').disabled = busy || !song;
  $('watchLesson').hidden = !song?.lessonUrl;
  const hasSong = !!song, hasAudio = hasSong && song.hasAudio;
  for (const id of ['audioButton', 'notesButton', 'replacePdfButton', 'deleteSongButton', 'previous', 'next', 'zoomIn', 'zoomOut', 'cuesButton'])
    $(id).disabled = busy || !hasSong;
  $('previous').disabled ||= page <= 1;
  $('next').disabled ||= !song || page >= pdf.pages;
  $('zoomIn').disabled ||= zoom >= 3 || !pageReady;
  $('zoomOut').disabled ||= zoom <= 1 || !pageReady;
  for (const id of ['play', 'back', 'forward', 'seek', 'speed', 'setA', 'setB', 'follow', 'cueMark',
    'readerPlay', 'readerBack', 'readerForward', 'toolsPlay', 'clearLoop'])
    $(id).disabled = busy || switchingTrack || !hasAudio;
  for (const id of ['cueMark', 'cuesButton']) $(id).disabled ||= !!alternatePdf;
  $('markCue').disabled = busy || switchingTrack || !hasAudio || !pageReady || !!alternatePdf;
  $('loop').disabled = busy || switchingTrack || !hasAudio || loopA === null || loopB === null;
  $('readerLoop').disabled = $('loop').disabled;
  $('addBacking').disabled = busy || switchingTrack || !hasAudio;
  $('originalTrack').disabled = busy || switchingTrack || !hasAudio;
  $('backingTrack').disabled = busy || switchingTrack || !song?.hasBacking;
  $('trackToggle').disabled = $('readerTrack').disabled = busy || switchingTrack || !song?.hasBacking;
  $('originalTrack').setAttribute('aria-pressed', String(audioVariant === 'original'));
  $('backingTrack').setAttribute('aria-pressed', String(audioVariant === 'backing'));
  $('trackToggle').textContent = switchingTrack ? 'Switching…' : !song?.hasBacking
    ? 'Original · no backing' : audioVariant === 'original' ? 'Original → tap for backing' : 'Backing → tap for original';
  $('readerTrack').textContent = audioVariant === 'backing' ? 'Backing' : 'Original';
  $('addBacking').textContent = song?.hasBacking ? 'Change backing MP3' : 'Add backing MP3';
  $('backingHint').textContent = song?.hasBacking
    ? 'Backing ready. Both versions share the same PDF cues. Switching keeps your playback position.'
    : 'Create a backing from this exact original MP3 with the Mac helper, then attach it. PDF cues will be preserved.';
  $('audioButton').textContent = hasAudio ? 'Change MP3' : 'Add MP3';
  $('audioEmpty').hidden = hasAudio;
  $('songTitle').textContent = song?.title || 'Choose a song';
  $('songTitle').title = song?.title || '';
  $('pageNumber').textContent = song ? `${page} / ${pdf.pages} · ${Math.round(zoom * 100)}%` : 'No PDF selected';
  $('cueCount').textContent = song?.cues.length || 0;
  $('play').textContent = audio.paused ? 'Play' : 'Pause';
  $('readerPlay').textContent = $('toolsPlay').textContent = $('play').textContent;
  $('follow').textContent = following ? 'Follow on' : 'Follow off';
  $('follow').setAttribute('aria-pressed', String(following));
  $('loop').textContent = looping ? 'Loop on' : 'Loop off';
  $('loop').setAttribute('aria-pressed', String(looping));
  $('readerLoop').textContent = $('loop').textContent;
  $('readerLoop').setAttribute('aria-pressed', String(looping));
  $('loopTimes').textContent = `A ${loopA === null ? '—' : clock(loopA)} · B ${loopB === null ? '—' : clock(loopB)}`;
  $('toolsLoopTimes').textContent = $('loopTimes').textContent;
  $('readerToggle').textContent = readerMode ? 'Split view' : 'FullScreen';
  $('readerToggle').setAttribute('aria-pressed', String(readerMode));
}
function setFollow(value) { following = value; activeCue = null; update(); }
function pagePoint() {
  return {
    y: $('pdfViewport').scrollTop / Math.max(1, $('pdfImage').clientHeight),
    x: $('pdfViewport').scrollLeft / Math.max(1, $('pdfImage').clientWidth)
  };
}
function cueScrollTop(position, pageAnchor) {
  const pane = $('pdfViewport'), image = $('pdfImage');
  const bottom = Math.max(0, pane.scrollHeight - pane.clientHeight);
  const top = Number.isFinite(pageAnchor) ? pageAnchor * image.clientHeight : position * bottom;
  return Math.max(0, Math.min(bottom, top));
}
function restorePosition(position, pageAnchor = null, horizontal = 0) {
  const pane = $('pdfViewport'), image = $('pdfImage');
  pane.scrollTop = cueScrollTop(position, pageAnchor);
  pane.scrollLeft = horizontal * image.clientWidth;
}
function scrollBetweenCues(current, next, time) {
  if (!pageReady || !current || !next || next.time <= current.time || next.page < current.page) return;
  const pane = $('pdfViewport');
  const start = cueScrollTop(current.position, current.pageAnchor);
  const end = next.page === current.page
    ? cueScrollTop(next.position, next.pageAnchor)
    : Math.max(0, pane.scrollHeight - pane.clientHeight);
  const progress = Math.max(0, Math.min(1, (time - current.time) / (next.time - current.time)));
  const top = start + (end - start) * progress;
  if (Math.abs(pane.scrollTop - top) >= 1) pane.scrollTop = top;
}
function seekPdf(cue) {
  const destination = cue || { page: 1, position: 0, pageAnchor: 0 };
  const pdf = alternatePdf || song;
  const destinationPage = Math.max(1, Math.min(pdf.pages, destination.page));
  if (pageReady && page === destinationPage) {
    restorePosition(destination.position, destination.pageAnchor ?? null, pagePoint().x);
  } else {
    renderPage(destinationPage, destination.position, destination.pageAnchor ?? null);
  }
}
async function renderPage(number = page, position = 0, pageAnchor = null) {
  if (!song) return;
  const pdf = alternatePdf || song;
  const horizontal = pagePoint().x;
  page = Math.max(1, Math.min(pdf.pages, number));
  const token = ++pageToken;
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
      restorePosition(position, pageAnchor, horizontal);
      if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
      pageReady = true;
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
function selectSong(item, autoplay = false) {
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
    if (autoplay) audio.play().catch(() => status('Recording loaded. Tap Play to begin.'));
  }
  $('seek').value = 0; $('seek').max = Math.max(1, song.duration);
  $('clock').textContent = `0:00 / ${clock(song.duration)}`;
  $('readerClock').textContent = $('toolsClock').textContent = $('clock').textContent;
  status(song.hasAudio ? (song.cues.length ? 'Ready. Follow turns on when playback starts.' : 'Ready. Scroll the PDF and mark sections to enable following.') : 'PDF imported. Tap Add MP3 to pair a recording.');
  renderPage(); update();
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
function mark() {
  if (!song?.hasAudio || !pageReady) return;
  audio.pause();
  pendingCue = { time: audio.currentTime, page, position: scrollPosition(), zoom,
    pageAnchor: Math.min(1, Math.max(0, pagePoint().y)), label: '' };
  $('cuePart').value = 'Verse'; $('customCueLabel').hidden = true;
  $('cueName').value = '';
  $('markSummary').textContent = `${clock(pendingCue.time)} · PDF page ${page} · ${Math.round(zoom * 100)}% zoom`;
  openDialog('markDialog');
}
function renderCues() {
  const list = $('cueList'); list.replaceChildren();
  for (const [index, cue] of song.cues.entries()) {
    const row = document.createElement('div'); row.className = 'cuerow';
    const jump = document.createElement('button');
    jump.textContent = `${clock(cue.time)} · ${cue.label} · page ${cue.page}`;
    jump.onclick = () => {
      if (busy) return;
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
function tick() {
  if (!song?.hasAudio || switchingTrack) return;
  const time = audio.currentTime;
  if (looping && loopA !== null && loopB !== null && !audio.paused && time >= loopB) {
    audio.currentTime = loopA; activeCue = null;
  }
  const now = audio.currentTime;
  $('seek').max = Number.isFinite(audio.duration) ? audio.duration : song.duration;
  if (document.activeElement !== $('seek')) $('seek').value = now;
  $('clock').textContent = `${clock(now)} / ${clock(Number.isFinite(audio.duration) ? audio.duration : song.duration)}`;
  $('readerClock').textContent = $('toolsClock').textContent = $('clock').textContent;
  const cues = song.cues;
  let index = -1;
  for (let i = 0; i < cues.length; i++) { if (cues[i].time <= now) index = i; else break; }
  const cue = cues[index], nextCue = cues[index + 1];
  $('currentSection').textContent = cue?.label || (cues.length ? 'Before first cue' : 'No cue yet');
  $('nextSection').textContent = nextCue ? `Next: ${nextCue.label} at ${clock(nextCue.time)}` :
    cue ? 'Final saved section' : 'Move the PDF to a section, then tap Mark here.';
  if (following) {
    if (activeCue !== index) {
      activeCue = index;
      seekPdf(cue);
    }
    scrollBetweenCues(cue, nextCue, now);
  }
}
document.querySelectorAll('[data-close]').forEach(button => {
  button.onclick = () => { if (!busy) closeDialog(button.dataset.close); };
});
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
});
$('libraryButton').onclick = () => { renderLibrary(); openDialog('libraryDialog'); };
$('search').oninput = renderLibrary;
function importDialog() { closeDialog('libraryDialog'); closeDialog('toolsDialog'); $('importStatus').textContent = ''; openDialog('importDialog'); }
$('importButton').onclick = importDialog; $('libraryImport').onclick = importDialog;
$('doImport').onclick = () => operation(async () => {
  const files = [...$('pdfFiles').files], selection = audioSelection($('importAudio').files);
  if (!files.length) throw new Error('Choose at least one PDF.');
  if (selection && files.length !== 1) throw new Error('Attach an MP3 when importing one PDF, or import PDFs only.');
  let last;
  for (const file of files) {
    $('importStatus').textContent = 'Importing ' + file.name + '…';
    status('Importing ' + file.name + '…');
    last = await uploadPdf(file);
  }
  if (selection) {
    $('importStatus').textContent = 'Attaching recording…';
    last = await uploadAudioSelection(last.id, selection);
  }
  await refreshLibrary();
  closeDialog('importDialog'); $('pdfFiles').value = ''; $('importAudio').value = '';
  selectSong(last); status(audioSavedStatus(last, 'Imported and saved on this Pi.'));
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
  $('clock').textContent = $('readerClock').textContent = $('toolsClock').textContent = '0:00 / 0:00';
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
  const point = pagePoint();
  alternatePdf = $('simpleVersion').checked === isSimplePdf(song) ? null : pairedPdf;
  const pdf = alternatePdf || song;
  pageReady = false;
  activeCue = null;
  window.GuitarChordViewer?.reset(pdf.id);
  status(isSimplePdf(pdf) ? 'Simple version' : 'Standard version');
  if (following && !switchingTrack) tick();
  else renderPage(page, 0, point.y);
};
$('previous').onclick = () => { setFollow(false); renderPage(page - 1); };
$('next').onclick = () => { setFollow(false); renderPage(page + 1); };
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
  if (following) { setFollow(false); status('Manual PDF navigation. Tap Follow on to resume cues.'); }
}, { passive: true });
$('follow').onclick = () => {
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
$('notesButton').onclick = () => {
  closeDialog('toolsDialog');
  $('titleInput').value = song.title; $('notesInput').value = song.notes; $('songLessonUrl').value = song.lessonUrl || ''; openDialog('notesDialog');
};
$('saveNotes').onclick = () => operation(async () => {
  await saveSettings({ title: $('titleInput').value, notes: $('notesInput').value, lessonUrl: $('songLessonUrl').value.trim() });
  closeDialog('notesDialog'); status('Song notes saved on this Pi.');
});
$('play').onclick = () => {
  if (audio.paused) audio.play().catch(message); else audio.pause();
};
$('back').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 5); activeCue = null; tick(); };
$('forward').onclick = () => { audio.currentTime = Math.min(song.duration, audio.currentTime + 5); activeCue = null; tick(); };
$('seek').oninput = () => { audio.currentTime = Number($('seek').value); activeCue = null; tick(); };
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
function showTools() { openDialog('toolsDialog'); }
$('toolsButton').onclick = $('readerTools').onclick = $('loopTools').onclick = showTools;
$('readerPlay').onclick = $('toolsPlay').onclick = $('play').onclick;
$('readerBack').onclick = $('back').onclick;
$('readerForward').onclick = $('forward').onclick;
$('readerLoop').onclick = $('loop').onclick;
$('trackToggle').onclick = $('readerTrack').onclick = () => switchTrack(audioVariant === 'original' ? 'backing' : 'original');
$('originalTrack').onclick = () => switchTrack('original');
$('backingTrack').onclick = () => switchTrack('backing');
$('clearLoop').onclick = () => { loopA = loopB = null; looping = false; update(); };
function setReaderMode(value) {
  const point = pagePoint();
  readerMode = value;
  document.body.classList.toggle('reader', readerMode);
  try { localStorage.setItem('guitar-reading-view', readerMode ? 'full' : 'split'); } catch {}
  restorePosition(0, point.y, point.x);
  update();
}
$('readerToggle').onclick = () => setReaderMode(!readerMode);
document.body.classList.toggle('reader', readerMode);
audio.addEventListener('play', () => {
  setFollow(Boolean(song?.cues.length));
  tick();
});
audio.addEventListener('pause', update);
audio.addEventListener('loadedmetadata', () => { audio.preservesPitch = true; tick(); });
audio.addEventListener('ended', () => {
  if (looping && loopA !== null) { audio.currentTime = loopA; audio.play().catch(message); }
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
