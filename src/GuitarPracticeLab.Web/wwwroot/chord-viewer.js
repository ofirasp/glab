(function () {
  'use strict';
  const el = id => document.getElementById(id);
  let identity = null, revision = null, currentPage = 1, index = [], pending = null, generation = 0;
  let originalName = '', alternateIdentity = null, selectedName = '', selectedShape = 0, options = [], settings = {};
  function readSettings() {
    try { settings = JSON.parse(localStorage.getItem('guitar-chords-' + identity) || '{}') || {}; } catch { settings = {}; }
    if (!['standard','other'].includes(settings.tuning)) settings.tuning = 'unknown';
    if (!Number.isInteger(settings.capo) || settings.capo < 0 || settings.capo > 12) settings.capo = 0;
    if (!settings.alternates || typeof settings.alternates !== 'object') settings.alternates = {};
    if (!settings.preferred || typeof settings.preferred !== 'object') settings.preferred = {};
  }
  function saveSettings() { try { localStorage.setItem('guitar-chords-' + identity, JSON.stringify(settings)); } catch {} }
  function clearPage() { el('chordTargets').replaceChildren(); }
  function sizeTargets() {
    const layer = el('chordTargets'), image = el('pdfImage');
    layer.style.width = image.clientWidth + 'px'; layer.style.height = image.clientHeight + 'px';
  }
  new ResizeObserver(sizeTargets).observe(el('pdfImage'));
  function targets() {
    clearPage();
    const hits = index.find(p => p.number === currentPage)?.chords || [];
    for (const [hitIndex,hit] of hits.entries()) {
      const button = document.createElement('button'); button.className = 'chordtarget';
      button.setAttribute('aria-label', 'Show ' + hit.name + ' chord'); button.title = hit.name;
      // Fixed pixel padding stays tight on tall, stitched PDFs; page-relative padding spans lyric rows.
      button.style.left = `max(0px, calc(${hit.x * 100}% - 2px))`;
      button.style.top = `max(0px, calc(${hit.y * 100}% - 2px))`;
      button.style.width = `calc(${Math.min(1 - hit.x, hit.width) * 100}% + 4px)`;
      button.style.height = `calc(${Math.min(1 - hit.y, hit.height) * 100}% + 4px)`;
      button.dataset.pdfChordKey=currentPage+':'+hitIndex;
      button.onclick = () => {if(document.dispatchEvent(new CustomEvent('guitar-pdf-chord-pick',{cancelable:true,detail:{hit,page:currentPage,index:hitIndex}})))showChord(hit.name);};
      el('chordTargets').append(button);
    }
    sizeTargets();
  }
  function list() {
    const names = [...new Set(index.flatMap(p => p.chords.map(c => c.name)))];
    el('songChordList').replaceChildren();
    for (const name of names) {
      const button = document.createElement('button');
      button.textContent = name;
      button.dataset.originalChord = name;
      button.onclick = () => showChord(name);
      el('songChordList').append(button);
    }
    el('chordScanStatus').textContent = names.length
      ? `${names.length} chord names found in this PDF. Check the selected tuning before using a shape.`
      : 'No chord text found. Scanned PDFs and some font encodings cannot be detected yet. You can look up a chord below.';
  }
  function reset(id) {
    generation++; identity = id; revision = null; index = []; pending = null;
    clearPage(); readSettings(); el('songChordList').replaceChildren();
    el('chordListButton').disabled = !id;
    el('chordScanStatus').textContent = 'Looking for chord names…';
    if (el('alternateChordDialog').open) el('alternateChordDialog').close();
    if (el('chordDialog').open) el('chordDialog').close();
  }
  async function showPage(detail) {
    if (identity !== detail.id) reset(detail.id);
    currentPage = detail.page;
    if (revision !== detail.version) {
      revision = detail.version; index = []; pending = null; generation++;
    }
    if (!pending) {
      const expected = generation;
      const params = new URLSearchParams({ v: revision });
      if (detail.variant) params.set('variant', detail.variant);
      pending = fetch(`/api/song-library/${encodeURIComponent(identity)}/chords?${params}`)
        .then(async response => {
          if (!response.ok) throw new Error('Chord detection is unavailable. Install poppler-utils on the Pi. Manual lookup still works.');
          const data = await response.json();
          if (expected !== generation) return;
          index = data; list(); targets();
        }).catch(error => {
          if (expected === generation) { el('chordScanStatus').textContent = error.message; pending = null; }
        });
    }
    targets();
  }
  function showChord(name) {
    const original = name.trim(); originalName = original;
    selectedName = alternate(original); options = GuitarChords.shapes(selectedName);
    const saved = settings.preferred[selectedName];
    selectedShape = Math.max(0, options.findIndex(shape => shape.frets.join(',') === saved));
    el('chordName').textContent = original === selectedName ? selectedName : original + ' → ' + selectedName;
    el('chordTuning').value = settings.tuning;
    el('chordCapo').value = settings.capo;
    el('restoreOriginalChord').disabled = original === selectedName;
    render();
    if (!el('chordDialog').open) el('chordDialog').showModal();
  }
  function svgNode(tag, attrs, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function diagram(shape) {
    const svg = svgNode('svg', {viewBox:'0 0 250 250',role:'img','aria-label':selectedName + ', low E to high e: ' + shape.frets.map(f => f < 0 ? 'muted' : f === 0 ? 'open' : 'fret ' + f).join(', ')});
    const positive = shape.frets.filter(f => f > 0), start = Math.max(...positive) <= 4 ? 1 : Math.min(...positive);
    const x = i => 50 + i * 30, y = f => 58 + (f - start + .5) * 33;
    svg.append(svgNode('rect',{x:0,y:0,width:250,height:250,rx:10,fill:'#f7f4e9'}));
    svg.append(svgNode('text',{x:125,y:20,'text-anchor':'middle',fill:'#26344a','font-size':12},'Low E → high e · fingers 1–4'));
    for (let i=0;i<6;i++) {
      svg.append(svgNode('line',{x1:x(i),x2:x(i),y1:58,y2:190,stroke:'#283448','stroke-width':1.3}));
      if (shape.frets[i] <= 0) svg.append(svgNode('text',{x:x(i),y:47,'text-anchor':'middle',fill:'#172238','font-size':18},shape.frets[i] < 0 ? '×' : '○'));
      svg.append(svgNode('text',{x:x(i),y:211,'text-anchor':'middle',fill:'#26344a','font-size':13},['E','A','D','G','B','e'][i]));
    }
    for (let i=0;i<5;i++) svg.append(svgNode('line',{x1:50,x2:200,y1:58+i*33,y2:58+i*33,stroke:'#283448','stroke-width':i===0&&start===1?5:1.3}));
    svg.append(svgNode('text',{x:13,y:81,fill:'#26344a','font-size':13},start+'fr'));
    if (shape.barre) svg.append(svgNode('line',{x1:x(shape.barre.from),x2:x(shape.barre.to),y1:y(shape.barre.fret),y2:y(shape.barre.fret),stroke:'#1a5b9f','stroke-width':17,'stroke-linecap':'round'}));
    shape.frets.forEach((f,i) => {
      if (f <= 0) return;
      svg.append(svgNode('circle',{cx:x(i),cy:y(f),r:10,fill:'#1a5b9f'}));
      svg.append(svgNode('text',{x:x(i),y:y(f)+4,'text-anchor':'middle',fill:'white','font-size':12,'font-weight':700},String(shape.labels[i])));
    });
    svg.append(svgNode('text',{x:125,y:235,'text-anchor':'middle',fill:'#26344a','font-size':12},'× muted · ○ open · bar = barre'));
    return svg;
  }
  function render() {
    const enabled = settings.tuning === 'standard' && options.length > 0;
    const container = el('chordDiagram'); container.replaceChildren();
    el('previousChordShape').disabled = el('nextChordShape').disabled = !enabled || options.length < 2;
    el('chordCapo').disabled = settings.tuning !== 'standard';
    if (enabled) {
      container.append(diagram(options[selectedShape]));
      el('chordShapeCount').textContent = `${selectedShape + 1} / ${options.length}`;
      el('chordExplanation').textContent = 'Suggested fingering. Choose a comfortable position.' + (settings.capo ? ` Capo at fret ${settings.capo}; shown frets start from the capo.` : ' No capo.');
    } else {
      const p = document.createElement('p'); p.className = 'hint';
      p.textContent = settings.tuning === 'unknown' ? 'Choose your guitar tuning to show a diagram.' : settings.tuning === 'other' ? 'Alternate-tuning shapes are not included yet. Standard-tuning diagrams are hidden.' : 'No verified shape for this chord spelling yet. Try its common equivalent in chord lookup.';
      container.append(p); el('chordShapeCount').textContent = '';
      el('chordExplanation').textContent = 'PDF chord names are detected as written; tuning and capo are your choices.';
    }
  }
  for (let fret=0;fret<=12;fret++) { const option=document.createElement('option');option.value=fret;option.textContent=fret ? 'Fret '+fret : 'No capo';el('chordCapo').append(option); }
  el('chordTuning').onchange = () => { settings.tuning=el('chordTuning').value; saveSettings(); render(); };
  el('chordCapo').onchange = () => { settings.capo=Number(el('chordCapo').value);saveSettings();render(); };
  function move(delta) { if (!options.length) return; selectedShape=(selectedShape+delta+options.length)%options.length;settings.preferred[selectedName]=options[selectedShape].frets.join(',');saveSettings();render(); }
  el('previousChordShape').onclick=()=>move(-1); el('nextChordShape').onclick=()=>move(1);
  el('chordListButton').onclick=()=>{ if(!el('chordsDialog').open)el('chordsDialog').showModal(); };
  el('chordLookupForm').onsubmit=event=>{ event.preventDefault(); const value=el('chordLookup').value.trim();if(value)showChord(value); };
  // Clicking outside either popup closes it without affecting playback.
  for (const id of ['chordDialog','chordsDialog']) el(id).addEventListener('click',event=>{
    const r=el(id).getBoundingClientRect();
    if(event.target===el(id)&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))el(id).close();
  });
  function applyAlternate(name) {
    if (name === originalName) delete settings.alternates[originalName];
    else settings.alternates[originalName] = name;
    saveSettings(); list(); showChord(originalName);
    document.dispatchEvent(new CustomEvent('guitar-chord-alternate-change', {detail:{id:identity}}));
  }
  function previewAlternate() {
    const name = el('alternateRoot').value + el('alternateType').value;
    const shape = GuitarChords.shapes(name)[0];
    el('alternatePreview').replaceChildren();
    el('applyAlternateChord').disabled = !shape;
    if (shape) el('alternatePreview').append(GuitarChordDiagram(shape, name));
    el('alternateChoiceName').textContent = name;
  }
  el('chooseAlternateChord').onclick = () => {
    alternateIdentity = identity;
    const parts = /^([A-G][#b]?)(.*)$/.exec(selectedName);
    const roots = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
    if (parts && !roots.includes(parts[1])) roots.push(parts[1]);
    el('alternateRoot').replaceChildren(...roots.map(value => new Option(value,value)));
    const types = [['','Major'],['m','Minor'],['7','7'],['maj7','Major 7'],['m7','Minor 7'],['sus2','Sus 2'],['sus4','Sus 4'],['6','6'],['m6','Minor 6'],['add9','Add 9'],['dim','Diminished'],['aug','Augmented'],['5','Power chord'],['9','9'],['m9','Minor 9'],['maj9','Major 9'],['m7b5','Minor 7 flat 5']];
    if (parts && !types.some(([value]) => value === parts[2])) types.push([parts[2],parts[2]]);
    el('alternateType').replaceChildren(...types.map(([value,label]) => new Option(label,value)));
    el('alternateRoot').value = parts?.[1] || 'C';
    el('alternateType').value = parts?.[2] || '';
    el('alternateOriginalName').textContent = 'Replace ' + originalName + ' during playback';
    previewAlternate();
    el('alternateChordDialog').showModal();
  };
  el('alternateRoot').onchange = el('alternateType').onchange = previewAlternate;
  el('applyAlternateChord').onclick = () => {
    if (alternateIdentity !== identity) return;
    const name = el('alternateRoot').value + el('alternateType').value;
    if (!GuitarChords.shapes(name).length) return;
    el('alternateChordDialog').close();
    applyAlternate(name);
  };
  el('restoreOriginalChord').onclick = () => applyAlternate(originalName);
  function alternate(name) {
    const replacement = settings.alternates?.[name];
    return typeof replacement === 'string' && GuitarChords.parse(replacement) ? replacement : name;
  }
  window.GuitarChordViewer = { reset, showPage, clearPage, alternate, alternates:()=>({...settings.alternates}) };
})();
