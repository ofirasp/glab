(()=>{
 'use strict';
 const paths={record:'<circle cx="12" cy="12" r="8"/>',delete:'<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',mute:'<path d="M3 9h4l5-4v14l-5-4H3Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m16 9 6 6m0-6-6 6"/>',volume:'<path d="M3 9h4l5-4v14l-5-4H3Z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',restart:'<path d="M4 5h3v14H4zM20 5v14l-11-7 11-7Z"/>',play:'<path d="M7 4v16l13-8L7 4Z"/>',pause:'<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>',stop:'<rect x="5" y="5" width="14" height="14" rx="1"/>',back:'<path d="M12 5v14L3 12l9-7Zm10 0v14l-9-7 9-7Z"/>',forward:'<path d="M2 5v14l9-7-9-7Zm10 0v14l9-7-9-7Z"/>'};
 const ids=new Set(['tone','timerStart','hear','hearMap','hearGuess','compareGuess','pointPlay','hearTimelineChange','pdfSyncHear','previewRhythm','previewTimingCalibration','previewLoop','reviewGuitar','reviewMix']);
 const contextual=new Set(['startTake','recordFollow','recordReviewButton','hear','hearMap','hearGuess','compareGuess','hearTimelineChange','pdfSyncHear','previewRhythm','previewTimingCalibration','reviewGuitar','reviewMix']);
 function kind(button,label){
  if(/^(?:Unmute|Mute)$/.test(label)||/^(?:🔊|🔇)$/.test(label))return label==='Unmute'||label==='🔇'?'mute':'volume';
  if(['startTake','recordFollow','recordReviewButton'].includes(button.id))return 'record';
  if(button.id==='recordLoop')return label==='Stop recording'?'stop':'record';
  if(button.id==='removeLoop'||button.dataset.mediaControl==='delete')return 'delete';
  if(/^\|[‹<]$/.test(label))return 'restart';
  if(button.id==='pointPlay'&&label==='Play / Pause')return document.getElementById('audio')?.paused===false?'pause':'play';
  if(/^[−-]5\s*s(?:ec)?$/i.test(label))return 'back';if(/^\+5\s*s(?:ec)?$/i.test(label))return 'forward';
  const known=ids.has(button.id)||button.dataset.mediaControl||button.id==='start'&&button.closest('#metro');
  if(!known)return null;
  if(/^(?:[■♪▶]\s*)?Stop\b/.test(label))return 'stop';if(/^Pause\b/.test(label))return 'pause';
  if(/^(?:[♪▶]\s*)?(?:Play|Start|Resume|Preview|Hear|Compare|Guitar only|With backing)\b/.test(label))return 'play';return null;
 }
 function render(button){
  const label=button.textContent.trim(),type=kind(button,label);if(!type)return;
  if(button.dataset.mediaIconLabel===label&&button.querySelector('svg[data-media-icon="'+type+'"]'))return;
  const existing=button.getAttribute('aria-label');if(!button.dataset.mediaIconLabel&&existing&&existing!==label)button.dataset.mediaIconAccessible=existing;let accessible=button.dataset.mediaIconAccessible||label;if(button.dataset.mediaIconAccessible&&/^(?:Play|Pause|Stop|Preview)\b/.test(accessible))accessible=accessible.replace(/^(?:Play|Pause|Stop|Preview)\b/,type==='stop'?'Stop':type==='pause'?'Pause':'Play');if(type==='mute'||type==='volume')accessible=(type==='mute'?'Unmute':'Mute')+(/song/i.test(existing||'')?' song':'');button.dataset.mediaIconLabel=label;button.classList.add('media-icon-button');button.setAttribute('aria-label',accessible);button.title=button.id==='pointPlay'&&label==='Play / Pause'?(type==='pause'?'Pause':'Play'):accessible;if(button.id==='pointPlay')button.setAttribute('aria-label',button.title);
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','22');icon.setAttribute('height','22');icon.setAttribute('fill','currentColor');icon.setAttribute('aria-hidden','true');icon.dataset.mediaIcon=type;icon.innerHTML=paths[type];
  const text=document.createElement('span');text.className=contextual.has(button.id)?'media-context-label':'media-icon-label';text.textContent=label;button.classList.toggle('media-context-button',contextual.has(button.id));
  if(contextual.has(button.id)){const prefix=/^[♪▶■]\s*/.exec(label);if(prefix){const hidden=document.createElement('span');hidden.className='media-icon-label';hidden.textContent=prefix[0];text.textContent=label.slice(prefix[0].length);button.replaceChildren(icon,hidden,text);return;}}
  button.replaceChildren(icon,text);
 }
 function scan(node){if(!(node instanceof HTMLElement))return;if(node.matches('button'))render(node);else node.querySelectorAll('button').forEach(render);}
 document.addEventListener('play',()=>{const button=document.getElementById('pointPlay');if(button)render(button);},true);document.addEventListener('pause',()=>{const button=document.getElementById('pointPlay');if(button)render(button);},true);
 scan(document.body);
 new MutationObserver(records=>{const buttons=new Set();for(const record of records){const target=record.target instanceof Element?record.target:record.target.parentElement;const button=target?.closest('button');if(button)buttons.add(button);for(const node of record.addedNodes)scan(node);}buttons.forEach(render);}).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
