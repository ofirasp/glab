(()=>{
'use strict';
let pendingAuto=null,unmatched=null,syncSeekTime=null,syncSeekFrame=0;
let identity='',stored=null,entries=[],hits=[],loading=false,generation=0,enabled=false,suspended=false,correcting=null,lastHit='',selected=0;
let syncChanges=[],skipIndexes={},pdfPages=[],editorOpen=false,editorPage=1,editorZoom=1,imageToken=0,imageURL=null,previewAudio=null,previewTimer=null,undo=[];
const el=id=>document.getElementById(id),pdf=()=>alternatePdf||song;
function key(){const p=pdf(),a=activeChordAnalysis();if(!p||!a?.changes?.length)return '';return JSON.stringify([p.id,p.variant||'',p.pdfVersion||p.updated,a.changes,window.GuitarChordViewer?.alternates?.()||{}]);}
function storageKey(){let hash=2166136261;for(const c of identity)hash=Math.imul(hash^c.charCodeAt(0),16777619);return 'guitar-auto-pdf-'+pdf().id+'-'+(hash>>>0);}
function sectionId(index=selected){return syncChanges[index]?.id??String(index);}
function isSkipped(index=selected){return !!stored?.skips?.[sectionId(index)];}
function anchorAt(index=selected){return stored?.anchors?.[sectionId(index)];}
function sourceEnd(source){const base=activeChordAnalysis().changes;for(let i=source+1;i<base.length;i++)if(base[i].name&&!stored?.skips?.[String(i)])return base[i].time;return song.duration;}
function alignCurrent(){
 const base=activeChordAnalysis().changes;
 syncChanges=base.map((c,i)=>({...c,id:String(i),source:i}));
 for(const repeat of stored.repeats||[]){const c=base[repeat.source],end=sourceEnd(repeat.source);if(c?.name&&Number.isFinite(repeat.time)&&repeat.time>c.time+.01&&repeat.time<end-.01)syncChanges.push({...c,time:repeat.time,id:repeat.source+'@'+repeat.time.toFixed(3),source:repeat.source,repeat:true});}
 syncChanges.sort((a,b)=>a.time-b.time||a.source-b.source);
 const anchors={};skipIndexes={};syncChanges.forEach((c,i)=>{if(stored.anchors[c.id])anchors[i]=stored.anchors[c.id];if(stored.skips?.[c.id])skipIndexes[i]=true;});
 selected=Math.max(0,Math.min(selected,syncChanges.length-1));
 // Bar subdivisions are local PDF positions, not additional evidence for the song-wide sequence.
 // Align original detections once so reviewing or adding a repeat cannot shift later sections.
 const baseAnchors={},baseSkips={};
 base.forEach((c,i)=>{if(stored.anchors[String(i)])baseAnchors[i]=stored.anchors[String(i)];if(stored.skips?.[String(i)])baseSkips[i]=true;});
 const mappedHits=hits.map(h=>({...h,writtenName:h.name,name:playbackChord(h.name)}));
 const original=PdfChordAlignment.align(base.map(c=>({...c,name:playbackChord(c.name)})),mappedHits,baseAnchors,baseSkips);
 const aligned=[];
 syncChanges.forEach((c,i)=>{
  if(!c.repeat){aligned.push({...original[c.source],sourceIndex:i,time:c.time});return;}
  const chosen=anchors[i]&&mappedHits.find(h=>h.key===anchors[i]&&PdfChordAlignment.normalize(h.name)===PdfChordAlignment.normalize(playbackChord(c.name)));
  const prior=aligned[i-1];
  aligned.push({sourceIndex:i,time:c.time,hit:skipIndexes[i]?null:chosen||prior?.hit||null,confident:!skipIndexes[i]&&(!!chosen||!!prior?.confident),skipped:!!skipIndexes[i]});
 });
 return PdfChordAlignment.resolveHeldBars(aligned,syncChanges,mappedHits,anchors,skipIndexes);
}
function checkpoint(){undo.push({anchors:{...stored.anchors},skips:{...stored.skips},repeats:(stored.repeats||[]).map(r=>({...r})),mode:stored.mode,selected,following,suspended});if(undo.length>50)undo.shift();}
function previousMapped(){for(let i=selected-1;i>=0;i--){if(isSkipped(i)||!syncChanges[i]?.name)continue;return entries[i]?.hit?{index:i,hit:hits.find(h=>h.key===entries[i].hit.key)||entries[i].hit}:null;}return null;}
function repeatCandidate(){
 const c=syncChanges[selected];if(!c?.name||isSkipped()||syncChanges.length>=1500||(stored?.repeats?.length||0)>=200)return null;
 const rhythm=SongRhythmPoints.at(song?.rhythm,c.time+.001),beats={'2/4':2,'3/4':3,'4/4':4,'5/4':5,'7/4':7,'6/8':2,'9/8':3,'12/8':4}[rhythm?.meter];if(!beats||!Number.isFinite(rhythm?.bpm)||rhythm.bpm<=0)return null;
 const bar=60/rhythm.bpm*beats,anchor=Number.isFinite(rhythm.firstDownbeat)?rhythm.firstDownbeat:0;
 let time=anchor+(Math.floor((c.time-anchor)/bar+1e-6)+1)*bar;
 if(Number.isFinite(rhythm.sectionEnd))time=Math.min(time,rhythm.sectionEnd);
 time=Math.round(time*1000)/1000;const end=sourceEnd(c.source);
 if(time<=c.time+.01||time>=end-.01)return null;
 return {source:c.source,time,id:c.source+'@'+time.toFixed(3)};
}

function clear(){document.querySelectorAll('.auto-pdf-highlight').forEach(e=>e.classList.remove('auto-pdf-highlight'));lastHit='';}
function save(){try{localStorage.setItem(storageKey(),JSON.stringify(stored));}catch{status('PDF sync is ready, but could not be saved in this browser.');}}
function refreshUI(){const next=key();if(next!==identity){const wasAuto=enabled;identity=next;pendingAuto=null;unmatched=null;generation++;stored=null;syncChanges=[];entries=[];hits=[];loading=false;enabled=false;suspended=false;correcting=null;undo=[];stopPreview();el('cancelPdfCorrection').hidden=true;clear();if(next)try{const value=JSON.parse(localStorage.getItem(storageKey())||'null');if(value?.anchors&&typeof value.anchors==='object'){stored=value;enabled=value.mode==='auto';}}catch{}if(stored)void prepare(false);else if(wasAuto&&next)status('The PDF or chord choices changed. Use Analyze → Sync PDF to update Auto Follow.');}
 el('pdfSyncResetAll').disabled=loading||!stored||!Object.keys(stored.anchors||{}).length&&!Object.keys(stored.skips||{}).length&&!(stored.repeats||[]).length;
 el('pdfSyncPrevious').disabled=loading||selected<=0;el('pdfSyncNext').disabled=loading||selected>=entries.length-1&&!repeatCandidate();
 el('pdfSyncDirection').disabled=loading||!stored;el('pdfSyncClose').disabled=loading||busy;el('pdfSyncSeek').disabled=loading||busy||!entries.length;el('pdfSyncStart').disabled=loading||busy||!entries.length;
 el('pdfSyncHear').disabled=loading||!syncChanges[selected]?.name;
 el('enableAutoPdf').disabled=loading||!entries.some(e=>e.hit);
 el('syncPdfButton').disabled=!next||loading||isRecordingFollow()||takingSongRecording;
 el('pdfFollowMode').disabled=!entries.some(e=>e.hit)||isRecordingFollow()||takingSongRecording;
 el('pdfFollowMode').value=enabled?'auto':'manual';
 el('autoPdfToggle').checked=enabled;el('autoPdfToggle').disabled=!next||loading||isRecordingFollow()||takingSongRecording;
 el('autoPdfResume').hidden=!enabled||!suspended;el('autoPdfFix').hidden=!enabled||unmatched===null;
}
async function prepare(announce=true){refreshUI();if(!identity){status('Analyze chords first, then sync the PDF.');return;}if(loading)return;loading=true;const version=++generation,current=identity,p=pdf();el('pdfSyncStatus').textContent='Reading chord positions and matching the sequence…';refreshUI();try{const params=new URLSearchParams({v:p.updated,order:'2'});if(p.variant)params.set('variant',p.variant);const response=await fetch(`${api}/${encodeURIComponent(p.id)}/chords?${params}`);if(!response.ok)throw Error('PDF chord text is unavailable. Check poppler-utils on the Pi.');const pages=await response.json();if(version!==generation||current!==key())return;pdfPages=pages;hits=PdfChordAlignment.positions(pages,stored?.direction||'auto',/[\u0590-\u05ff]/.test(song?.title||''));if(!hits.length)throw Error('No selectable chord text found. Use Manual Follow for scanned sheets.');stored??={anchors:{},skips:{},repeats:[],mode:'manual'};entries=alignCurrent();save();selected=Math.max(0,chordIndexAt((takePlayback??audio).currentTime,syncChanges));renderReview();if(editorOpen)void showSelected();if(announce)status('PDF sync prepared. Review uncertain sections before enabling Auto PDF.');}catch(e){if(version===generation){enabled=false;entries=[];el('pdfSyncStatus').textContent=e.message;status(e.message);}}finally{if(version===generation){loading=false;refreshUI();}}}
function renderReview(){el('pdfSyncUndo').disabled=!undo.length;el('pdfSyncHear').disabled=!syncChanges[selected]?.name||loading;el('pdfSyncResetSection').disabled=!anchorAt()&&!isSkipped()&&!syncChanges[selected]?.repeat;el('pdfSyncResetAll').disabled=!stored||!Object.keys(stored.anchors||{}).length&&!Object.keys(stored.skips||{}).length&&!(stored.repeats||[]).length;const ready=entries.filter(e=>e.confident).length;const skipped=entries.filter(e=>e.skipped).length;el('pdfSyncStatus').textContent=`${ready} aligned · ${skipped} skipped · ${entries.length-ready-skipped} to check.`;const e=entries[selected],c=syncChanges[selected];const reviewTime=syncSeekTime??c?.time??0;el('pdfSyncSeek').max=song?.duration||1;el('pdfSyncSeek').value=reviewTime;el('pdfSyncTime').textContent=clock(reviewTime)+' / '+clock(song?.duration||0);el('pdfSyncSeek').setAttribute('aria-valuetext',el('pdfSyncTime').textContent);el('pdfSyncSection').textContent=c?(c.name===playbackChord(c.name)?c.name:c.name+' → '+playbackChord(c.name)):'No chord';el('pdfSyncDirection').value=stored?.direction||'auto';const printed=hits.findIndex(h=>h.key===e?.hit?.key),nextPrinted=printed>=0?hits[printed+1]:null;el('pdfSyncPrintedNext').textContent=nextPrinted?'Next on PDF: '+nextPrinted.name:'';el('pdfSyncOrdinal').textContent=c?`${selected+1} / ${entries.length} · ${clock(c.time)}${c.repeat?' · next bar':''}`:'';el('pdfSyncConfidence').textContent=isSkipped()?'Skipped for PDF sync':e?.hit?`${anchorAt()?'✓ Saved match':e.confident?'Suggested match':'Check suggestion'} · page ${e.hit.page}`:'No matching chord text in this PDF';el('pdfSyncPrevious').disabled=selected<=0;el('pdfSyncNext').disabled=selected>=entries.length-1&&!repeatCandidate();el('pdfSyncCorrect').disabled=!c?.name||!hits.some(h=>PdfChordAlignment.normalize(playbackChord(h.name))===PdfChordAlignment.normalize(playbackChord(c.name)));el('enableAutoPdf').disabled=!entries.some(e=>e.hit);el('pdfSyncSkip').disabled=loading||!c?.name;el('pdfSyncSkip').textContent=isSkipped()?'Restore':'Skip detection';el('pdfSyncSkip').setAttribute('aria-label',isSkipped()?'Restore skipped detection':'Skip this detection for PDF sync');el('pdfSyncPickHint').textContent=isSkipped()?'Ignored during PDF follow. Restore to match it again.':c?.name?'Tap the matching '+(playbackChord(c.name)||c.name)+' chord on the PDF.':'No chord here. Choose another change.';}
function setMode(mode){unmatched=null;enabled=mode==='auto';suspended=false;clear();if(stored){stored.mode=enabled?'auto':'manual';save();}refreshUI();update();if(enabled)tick((takePlayback??audio).currentTime);}
function showHit(hit){if(!hit||!pageReady||page!==hit.page)return false;const targets=[...document.querySelectorAll('.chordtarget')];const target=targets.find(e=>e.dataset.pdfChordKey===hit.key);if(!target)return false;
 document.querySelectorAll('.auto-pdf-highlight').forEach(e=>{if(e!==target)e.classList.remove('auto-pdf-highlight');});target.classList.add('auto-pdf-highlight');const viewport=el('pdfViewport'),rect=target.getBoundingClientRect(),view=viewport.getBoundingClientRect();const top=Math.max(0,viewport.scrollTop+rect.top-view.top+rect.height/2-viewport.clientHeight/2);let left=viewport.scrollLeft;if(rect.left<view.left)left+=rect.left-view.left-12;else if(rect.right>view.right)left+=rect.right-view.right+12;viewport.scrollTo({top,left,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return true;
}
function tick(time){refreshUI();if(editorOpen)return true;if(!enabled)return false;if(isRecordingFollow()){clear();return false;}if(suspended)return true;const i=PdfChordAlignment.indexAt(time,syncChanges,SongRhythmPoints.at(song?.rhythm,time),skipIndexes),entry=entries[i];if(!entry?.hit){clear();if(i>=0&&unmatched!==sectionId(i)){unmatched=sectionId(i);status('No PDF position for '+(syncChanges[i]?.name||'this chord')+'. Tap Match PDF.');}return true;}if(unmatched!==null){unmatched=null;el('autoPdfFix').hidden=true;status('Auto PDF Follow on.');}const hit=entry.hit;if(!pageReady)return true;const token=hit.key+':'+zoom+':'+page+':'+el('pdfViewport').clientHeight;if(lastHit===token&&[...document.querySelectorAll('.auto-pdf-highlight')].some(target=>target.dataset.pdfChordKey===hit.key))return true;if(page!==hit.page){clear();void renderPage(hit.page);return true;}if(showHit(hit))lastHit=token;return true;}
function pause(){if(enabled&&!suspended){suspended=true;clear();refreshUI();update();status('Auto PDF paused for manual navigation. Tap Resume Auto PDF to continue.');}}
function resetCorrections(all){if(!stored)return;checkpoint();if(all){stored.anchors={};stored.skips={};stored.repeats=[];}else{delete stored.anchors[sectionId()];if(stored.skips)delete stored.skips[sectionId()];if(syncChanges[selected]?.repeat){const id=sectionId();stored.repeats=(stored.repeats||[]).filter(r=>r.source+'@'+r.time.toFixed(3)!==id);selected=Math.max(0,selected-1);}}entries=alignCurrent();clear();save();renderReview();if(all){setMode('manual');setFollow(Boolean(song?.cues.length));status('PDF sync corrections cleared. Manual recorded follow restored; your Follow marks are unchanged.');}else status('Section correction cleared. The automatic estimate is shown again.');if(editorOpen)void showSelected();}
el('pdfSyncResetSection').onclick=()=>resetCorrections(false);el('pdfSyncResetAll').onclick=()=>resetCorrections(true);
function stopPreview(){clearTimeout(previewTimer);if(previewAudio){previewAudio.pause();previewAudio.removeAttribute('src');previewAudio.load();previewAudio=null;}el('pdfSyncHear').textContent='♪ Hear bar';}
function stopEditor(){cancelAnimationFrame(syncSeekFrame);syncSeekFrame=0;syncSeekTime=null;pendingAuto=null;editorOpen=false;stopPreview();imageToken++;if(imageURL){URL.revokeObjectURL(imageURL);imageURL=null;}el('pdfSyncImage').removeAttribute('src');el('pdfSyncTargets').replaceChildren();clear();}
function closeEditor(toTools=true){el('pdfSyncDialog').close();stopEditor();if(toTools)openDialog('toolsDialog');}
function openEditor(enableOnDone=false){pendingAuto=enableOnDone===true?key():null;window.SongChordMatch?.stop();(takePlayback??audio).pause();if(chordFocus)el('chordFocusToggle').click();closeDialog('toolsDialog');editorOpen=true;undo=[];openDialog('pdfSyncDialog');void prepare();}
async function renderEditorPage(number,focusKey=null){
 if(!editorOpen)return;const p=pdf(),version=++imageToken;editorPage=Math.max(1,Math.min(p.pages,number));el('pdfSyncPageLabel').textContent=editorPage+' / '+p.pages;el('pdfSyncPagePrevious').disabled=editorPage<=1;el('pdfSyncPageNext').disabled=editorPage>=p.pages;
 el('pdfSyncPageStatus').textContent='Loading PDF…';el('pdfSyncTargets').replaceChildren();
 try{const params=new URLSearchParams({v:p.updated});if(p.variant)params.set('variant',p.variant);const response=await fetch(`${api}/${p.id}/page/${editorPage}?${params}`);if(!response.ok)throw Error('Could not load this PDF page.');const blob=await response.blob();if(version!==imageToken||!editorOpen)return;const url=URL.createObjectURL(blob),image=el('pdfSyncImage');if(imageURL)URL.revokeObjectURL(imageURL);imageURL=url;image.src=url;await image.decode();if(version!==imageToken||!editorOpen)return;
  el('pdfSyncPaper').style.width=editorZoom*100+'%';el('pdfSyncPageStatus').textContent='';const c=syncChanges[selected],expected=PdfChordAlignment.normalize(playbackChord(c?.name));
  for(const h of hits.filter(h=>h.page===editorPage)){const button=document.createElement('button');button.type='button';button.className='pdf-sync-hit';button.dataset.key=h.key;button.setAttribute('aria-label','Choose '+h.name+' on PDF page '+h.page);button.title=h.name;button.style.left=`calc(${h.x*100}% - 2px)`;button.style.top=`calc(${h.y*100}% - 2px)`;button.style.width=`calc(${h.width*100}% + 4px)`;button.style.height=`calc(${h.height*100}% + 4px)`;button.classList.toggle('matching',PdfChordAlignment.normalize(playbackChord(h.name))===expected);button.classList.toggle('selected',h.key===entries[selected]?.hit?.key);button.classList.toggle('saved',h.key===anchorAt());button.onclick=()=>chooseSpot(h);el('pdfSyncTargets').append(button);}
  if(focusKey)centerEditorHit(focusKey);else{el('pdfSyncViewport').scrollTop=0;el('pdfSyncViewport').scrollLeft=0;}
 }catch(e){if(version===imageToken)el('pdfSyncPageStatus').textContent=e.message;}
}
function centerEditorHit(key){const button=[...el('pdfSyncTargets').children].find(e=>e.dataset.key===key);if(!button)return;const v=el('pdfSyncViewport'),a=button.getBoundingClientRect(),b=v.getBoundingClientRect();v.scrollTo({top:Math.max(0,v.scrollTop+a.top-b.top+a.height/2-v.clientHeight/2),left:Math.max(0,v.scrollLeft+a.left-b.left+a.width/2-v.clientWidth/2),behavior:'instant'});}
function showSelected(atTime=null){syncSeekTime=atTime;renderReview();const h=entries[selected]?.hit||(isSkipped()?previousMapped()?.hit:null);return renderEditorPage(h?.page||editorPage,h?.key);}
function selectSection(direction){stopPreview();if(direction>0){const repeat=repeatCandidate(),next=syncChanges.slice(selected+1).find(c=>c.name);if(repeat&&(!next||repeat.time<next.time-.01)){checkpoint();stored.repeats??=[];if(!stored.repeats.some(r=>r.source===repeat.source&&Math.abs(r.time-repeat.time)<.01))stored.repeats.push({source:repeat.source,time:repeat.time});entries=alignCurrent();selected=syncChanges.findIndex(c=>c.id===repeat.id);save();void showSelected();return;}}const changes=syncChanges;let next=selected+direction;while(next>=0&&next<changes.length&&!changes[next].name)next+=direction;if(next<0||next>=changes.length)return;selected=next;void showSelected();}
function chooseSpot(hit){const c=syncChanges[selected];if(!c||busy)return;stopPreview();if(PdfChordAlignment.normalize(playbackChord(hit.name))!==PdfChordAlignment.normalize(playbackChord(c.name))){void replaceDetectedChord({identity,id:sectionId(),hit});return;}checkpoint();stored.anchors[sectionId()]=hit.key;if(stored.skips)delete stored.skips[sectionId()];entries=alignCurrent();save();renderReview();el('pdfSyncPickHint').textContent='✓ Saved. Hear it to check, or choose Next.';for(const button of el('pdfSyncTargets').children){button.classList.toggle('selected',button.dataset.key===hit.key);button.classList.toggle('saved',button.dataset.key===hit.key);}centerEditorHit(hit.key);}
async function replaceDetectedChord(choice){
 const c=syncChanges[selected];
 if(!choice||choice.identity!==identity||choice.id!==sectionId()||!c)return;
 await operation(async()=>{
  const previous=structuredClone(activeChordAnalysis()),target=analysisTarget(),owner=song.id,audioVersion=song.audioVersion,oldName=previous.changes[c.source].name;
  if(target.variant==='simple'&&!song.simpleChordAnalysis)throw Error('Analyze the Simple PDF once before correcting its chords.');
  const edit=PdfChordAlignment.editSection(previous,syncChanges,selected,stored,choice.hit.name,choice.hit.key);
  const draft=edit.analysis,kept=edit.state,selectedId=edit.selectedId,oldIdentity=identity;
  await request(`/${target.id}/chord-timeline`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioVersion,variant:target.variant,previous,analysis:draft})});
  // Read back the persisted timeline; a successful response alone is not a saved correction.
  const library=await request('',{cache:'no-store'}),savedSong=library.find(item=>item.id===target.id);
  const result=target.variant==='simple'?savedSong?.simpleChordAnalysis:savedSong?.chordAnalysis;
  if(!result||result.changes.length!==draft.changes.length||result.changes.some((change,index)=>change.time!==draft.changes[index].time||change.name!==draft.changes[index].name))throw Error('The Pi did not retain this chord correction. It has not been marked as saved. Please try again.');
  if(song?.id!==owner||song.audioVersion!==audioVersion||identity!==oldIdentity)return;
  window.SongChordMatch?.stop();
  if(target.variant==='simple')song.simpleChordAnalysis=result;else target.pdf.chordAnalysis=result;
  songs=library;
  identity=key();if(pendingAuto===oldIdentity)pendingAuto=identity;stored=kept;undo=[];entries=alignCurrent();selected=Math.max(0,syncChanges.findIndex(section=>section.id===selectedId));save();clear();stageDiagramName='';showPlayingChord(audio.currentTime);update();
  await showSelected();el('pdfSyncPickHint').textContent='Saved '+oldName+' → '+choice.hit.name+'. Chord bars, matching and PDF follow now use the corrected chord.';
 });
}
el('pdfSyncDirection').onchange=()=>{if(!stored||loading)return;stopPreview();stored.direction=el('pdfSyncDirection').value;hits=PdfChordAlignment.positions(pdfPages,stored.direction,/[\u0590-\u05ff]/.test(song?.title||''));entries=alignCurrent();save();clear();void showSelected();};
el('pdfSyncSkip').onclick=()=>{if(!stored)return;stopPreview();checkpoint();stored.skips??={};if(isSkipped())delete stored.skips[sectionId()];else{stored.skips[sectionId()]=true;delete stored.anchors[sectionId()];}entries=alignCurrent();save();clear();void showSelected();};
el('syncPdfButton').onclick=openEditor;el('autoPdfFix').onclick=()=>openEditor(true);
el('pdfSyncClose').onclick=()=>{if(loading||busy)return;if(pendingAuto===identity&&pendingAuto){if(entries.some(e=>e.hit)){setMode('auto');closeEditor();status('Auto PDF Follow on.');return;}status('Auto PDF could not be enabled: '+(el('pdfSyncStatus').textContent||'No matching PDF positions found.'));}closeEditor();};
el('pdfSyncDialog').addEventListener('close',stopEditor);
el('pdfSyncDialog').addEventListener('cancel',()=>stopEditor());
el('pdfSyncPrevious').onclick=()=>selectSection(-1);el('pdfSyncNext').onclick=()=>selectSection(1);
function seekSync(time){
 if(loading||busy||!syncChanges.length)return;
 stopPreview();const at=Math.max(0,Math.min(song.duration,time));audio.currentTime=at;
 selected=Math.max(0,chordIndexAt(at,syncChanges));void showSelected(at);
}
el('pdfSyncSeek').oninput=()=>{cancelAnimationFrame(syncSeekFrame);syncSeekFrame=requestAnimationFrame(()=>seekSync(Number(el('pdfSyncSeek').value)));};
el('pdfSyncStart').onclick=()=>{cancelAnimationFrame(syncSeekFrame);seekSync(0);};
el('pdfSyncNow').onclick=()=>{stopPreview();selected=Math.max(0,chordIndexAt((takePlayback??audio).currentTime,syncChanges));void showSelected();};
el('pdfSyncCorrect').onclick=()=>void showSelected();
el('pdfSyncPagePrevious').onclick=()=>void renderEditorPage(editorPage-1);el('pdfSyncPageNext').onclick=()=>void renderEditorPage(editorPage+1);
function zoomEditor(delta){editorZoom=delta===0?1:Math.max(.75,Math.min(3,editorZoom+delta));void renderEditorPage(editorPage,entries[selected]?.hit?.page===editorPage?entries[selected].hit.key:null);}
el('pdfSyncZoomIn').onclick=()=>zoomEditor(.25);el('pdfSyncZoomOut').onclick=()=>zoomEditor(-.25);el('pdfSyncZoomFit').onclick=()=>zoomEditor(0);
el('pdfSyncUndo').onclick=()=>{if(!undo.length||!stored)return;stopPreview();const prior=undo.pop();stored.anchors=prior.anchors;stored.skips=prior.skips||{};stored.repeats=prior.repeats||[];selected=prior.selected;setMode(prior.mode||'manual');suspended=prior.suspended;setFollow(prior.following);entries=alignCurrent();save();void showSelected();};
el('pdfSyncHear').onclick=()=>{if(previewAudio){stopPreview();return;}const c=syncChanges[selected];if(!c)return;const player=new Audio(audio.currentSrc||audio.src);previewAudio=player;player.volume=audio.volume;player.muted=audio.muted;player.playbackRate=audio.playbackRate;const next=syncChanges.slice(selected+1).find(change=>change.name),bar=repeatCandidate();const start=Math.max(0,c.time),end=Math.min(song.duration,next?.time??song.duration,bar?.time??song.duration);el('pdfSyncHear').textContent='■ Stop preview';player.addEventListener('timeupdate',()=>{if(previewAudio===player&&player.currentTime>=end)stopPreview();});player.addEventListener('loadedmetadata',async()=>{if(previewAudio!==player)return;try{player.currentTime=start;await player.play();if(previewAudio!==player){player.pause();return;}previewTimer=setTimeout(stopPreview,(end-start)/player.playbackRate*1000+500);}catch(e){if(previewAudio===player){stopPreview();el('pdfSyncPickHint').textContent='Could not preview audio: '+e.message;}}},{once:true});player.addEventListener('error',()=>{if(previewAudio===player){stopPreview();el('pdfSyncPickHint').textContent='Audio preview unavailable.';}});player.load();};
el('pdfSyncManual').onclick=()=>{setMode('manual');tickManual();closeEditor(false);status('Manual recorded Follow restored. Your marks are unchanged.');};
el('enableAutoPdf').onclick=()=>{setMode('auto');closeEditor(false);status('Auto PDF Follow on. Your recorded cues are unchanged.');};
el('autoPdfToggle').onchange=()=>{if(el('autoPdfToggle').checked){if(entries.some(e=>e.hit)){setMode('auto');status('Auto PDF Follow on.');}else{el('autoPdfToggle').checked=false;openEditor(true);}}else{setMode('manual');tickManual();status('Manual recorded Follow restored. Your sync corrections are kept.');}};
el('pdfFollowMode').onchange=()=>{setMode(el('pdfFollowMode').value);if(!enabled)tickManual();};
function tickManual(){setFollow(Boolean(song?.cues.length));activeCue=null;}
function resume(){if(!enabled)return;suspended=false;lastHit='';refreshUI();update();tick((takePlayback??audio).currentTime);status('Auto PDF Follow resumed.');}
el('autoPdfResume').onclick=resume;
for(const type of ['wheel','pointerdown','keydown'])el('pdfViewport').addEventListener(type,event=>{if(correcting!==null||event.target.closest('.chordtarget'))return;pause();},{passive:true});
for(const id of ['previous','next','recordFollow'])el(id).addEventListener('click',pause,{capture:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPreview();});
window.addEventListener('pagehide',stopPreview);
new ResizeObserver(()=>{lastHit='';}).observe(el('pdfImage'));
function timelineChanged(previous,next){
 if(!stored||!identity){refreshUI();return;}
 let old;try{old=JSON.parse(identity);}catch{return;}
 if(JSON.stringify(old[3])!==JSON.stringify(previous.changes)||activeChordAnalysis()!==next)return;
 const updated=key();if(updated===identity)return;
 stored=PdfChordAlignment.migrateTimelineState(previous,next,stored);identity=updated;generation++;loading=false;undo=[];unmatched=null;clear();save();
 if(hits.length){entries=alignCurrent();selected=Math.max(0,chordIndexAt(audio.currentTime,syncChanges));refreshUI();}
 else void prepare(false);
}
window.AutoPdfFollow={tick,refreshUI,setMode,pause,resume,timelineChanged,state:()=>({enabled,suspended})};refreshUI();
})();
