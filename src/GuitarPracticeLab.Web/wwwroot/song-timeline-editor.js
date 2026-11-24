(() => {
  'use strict';
  let editor=null,waveRequest=null,previewEnd=null,previewTimer=null,previewToken=0;
  const dialog=$('timelineEditorDialog'),svg=$('timelineEditorGraphic');
  const stamp=time=>`${Math.floor(time/60)}:${(time%60).toFixed(2).padStart(5,'0')}`;
  const dirty=()=>editor&&JSON.stringify(editor.draft)!==JSON.stringify(editor.previous);
  const say=text=>$('timelineEditorStatus').textContent=text;
  function stopPreview(){previewToken++;clearInterval(previewTimer);previewTimer=null;previewEnd=null;audio.pause();$('hearTimelineChange').textContent='▶ Hear section';}
  function dismiss(){stopPreview();waveRequest?.abort();editor=null;dismissDialog('timelineEditorDialog');}
  async function close(){
    if(busy||!editor)return;
    const current=editor;stopPreview();let saved=!dirty();
    if(!saved){$('closeTimelineEditor').textContent='Saving…';await operation(async()=>{await saveCorrections(current);saved=true;});$('closeTimelineEditor').textContent='Done';}
    if(saved&&editor===current)dismiss();else if(editor)draw();
  }
  function cancel(){if(!busy&&editor)dismiss();}
  function splitTime(){
    if(!editor)return null;
    const change=editor.draft.changes[editor.index],end=editor.draft.changes[editor.index+1]?.time??editor.duration;
    const boundary=SongRhythmPoints.barAt(song?.rhythm,change.time+.001)?.end;
    return Number.isFinite(boundary)&&boundary>change.time+.02&&boundary<end-.02?Math.round(boundary*1000)/1000:null;
  }
  function draw(){
    if(!editor)return;
    const {draft,index,start,end,bins}=editor;svg.replaceChildren();
    const span=end-start,x=t=>12+(t-start)/span*716;
    const add=(tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);if(text!==undefined)node.textContent=text;svg.append(node);return node;};
    add('rect',{x:0,y:0,width:740,height:112,rx:9,fill:'#102035'});
    for(let i=0;i<=4;i++){const time=start+span*i/4;add('text',{x:x(time),y:13,fill:'#9cb4cf','font-size':10,'text-anchor':i===4?'end':'start'},stamp(time));}
    if(bins)bins.forEach((value,i)=>{const cx=12+i*716/bins.length,h=Math.max(1,value*29);add('line',{x1:cx,x2:cx,y1:41-h,y2:41+h,stroke:'#789bbb','stroke-width':2});});
    else add('text',{x:370,y:43,'text-anchor':'middle',fill:'#789bbb','font-size':11},'Waveform loading…');
    draft.changes.forEach((change,i)=>{
      const a=Math.max(start,change.time),b=Math.min(end,draft.changes[i+1]?.time??editor.duration);
      if(b<=a)return;
      const rect=add('rect',{x:x(a),y:73,width:Math.max(1,x(b)-x(a)-2),height:32,rx:5,fill:i===index?'#68542c':'#2c445f',stroke:i===index?'#e6bf69':'#47647e','data-change':i});
      rect.onclick=()=>select(i);
      if(x(b)-x(a)>22){const text=add('text',{x:(x(a)+x(b))/2,y:96,fill:i===index?'#ffdd97':'#eaf1fa','font-size':19,'text-anchor':'middle','pointer-events':'none'},change.name||'—');}
    });
    let bar=SongRhythmPoints.barAt(song?.rhythm,start);
    for(let count=0;bar&&bar.start<end&&count<150;count++){
      if(bar.start>=start){add('line',{x1:x(bar.start),x2:x(bar.start),y1:20,y2:108,stroke:'#c2d1e0','stroke-width':1,'stroke-dasharray':'3 3','data-bar-start':bar.start,'pointer-events':'none'});}
      const centre=(Math.max(start,bar.start)+Math.min(end,bar.end))/2;
      add('text',{x:x(centre),y:66,fill:'#b2c6dd','font-size':10,'text-anchor':'middle','pointer-events':'none'},bar.number>0?'Bar '+bar.number:'Lead-in');
      if(bar.end<=bar.start+.00001)break;bar=SongRhythmPoints.barAt(song?.rhythm,bar.end+.00001);
    }
    const time=draft.changes[index].time;
    if(time>=start&&time<=end){const cx=x(time);add('line',{x1:cx,x2:cx,y1:22,y2:107,stroke:'#ffd47e','stroke-width':2});add('rect',{x:cx-14,y:22,width:28,height:26,rx:5,fill:'#ffd47e','data-handle':'true'});add('text',{x:cx,y:41,fill:'#1b2b40','font-size':18,'text-anchor':'middle','pointer-events':'none'},'↔');}
    $('timelineRootButton').textContent=$('timelineRoot').value+' ▾';$('timelineStart').textContent=stamp(time);const length=(draft.changes[index+1]?.time??editor.duration)-time,measure=SongRhythmPoints.barAt(song?.rhythm,time+.001);$('timelineDurationInfo').textContent=measure?' · '+(length/measure.duration).toFixed(1)+' bars':' · '+length.toFixed(1)+'s';$('splitTimelineBar').disabled=splitTime()===null;
    $('timelineSection').replaceChildren(...draft.changes.map((c,i)=>new Option(`${i+1} · ${c.name||'—'} · ${stamp(c.time)}`,i)));
    $('timelineSection').value=index;$('timelinePrevious').disabled=index<=0;$('timelineNext').disabled=index>=draft.changes.length-1;
    $('deleteTimelineChange').disabled=draft.changes.length<2;
  }
  function setTime(time){
    if(!editor)return;
    const {changes}=editor.draft,i=editor.index;
    changes[i].time=Math.round(Math.max(i?changes[i-1].time+.01:0,Math.min(time,(changes[i+1]?.time??editor.duration)-.01))*100)/100;
    draw();say('Unsaved correction. Hear the change, then choose Done to save.');
  }
  async function select(index,focusTime=null){
    if(!editor)return;stopPreview();editor.index=index;
    const change=editor.draft.changes[index],parts=/^([A-G][#b]?)(.*)$/.exec(change.name||'G');
    const roots=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];if(parts&&!roots.includes(parts[1]))roots.push(parts[1]);
    $('timelineRoot').replaceChildren(...roots.map(root=>new Option(root,root)));
    const qualities=[['','Major'],['m','Minor'],['7','7'],['maj7','Major 7'],['m7','Minor 7'],['sus2','Sus 2'],['sus4','Sus 4'],['add9','Add 9'],['9','9'],['m9','Minor 9'],['6','6'],['dim','Diminished'],['m7b5','Minor 7 flat 5']];
    if(parts&&!qualities.some(([value])=>value===parts[2]))qualities.push([parts[2],parts[2]]);
    $('timelineQuality').replaceChildren(...qualities.map(([value,label])=>new Option(label,value)));
    $('timelineRoot').value=parts?.[1]||'G';$('timelineQuality').value=parts?.[2]||'';
    editor.start=Math.max(0,(focusTime??change.time)-2);const sectionEnd=editor.draft.changes[index+1]?.time??editor.duration;editor.end=Math.min(editor.duration,Math.max(editor.start+6,Math.min(editor.start+20,sectionEnd+1)));editor.start=Math.max(0,editor.end-Math.max(6,editor.end-editor.start));editor.bins=null;draw();
    waveRequest?.abort();const controller=new AbortController();waveRequest=controller;
    const expected=editor;
    try{const response=await fetch(`${api}/${editor.target.id}/waveform?start=${editor.start}&end=${editor.end}`,{signal:controller.signal});if(!response.ok)throw Error('Waveform unavailable; time adjustment still works.');const result=await response.json();if(editor!==expected||waveRequest!==controller)return;editor.bins=result.bins;draw();}
    catch(error){if(!controller.signal.aborted)say(error.message);}
  }
  $('editChordTimeline').onclick=()=>{
    if(!song?.hasAudio||!activeChordAnalysis()?.changes.length||takingSongRecording||isRecordingFollow())return;
    audio.pause();window.SongChordMatch?.stop();closeDialog('toolsDialog');
    const previous=structuredClone(activeChordAnalysis());
    const target=analysisTarget();
    // A fallback timeline must be analyzed for this PDF before editing it.
    if(target.variant==='simple'&&!song.simpleChordAnalysis){status('Analyze the Simple PDF once before editing its timeline.');openDialog('toolsDialog');return;}
    editor={owner:song.id,audioVersion:song.audioVersion,target,previous,draft:structuredClone(previous),duration:song.duration,index:0,start:0,end:Math.min(6,song.duration),bins:null};
    $('timelineEditorSeek').max=song.duration;$('timelineEditorSeek').value=audio.currentTime;
    const index=Math.max(0,chordIndexAt(audio.currentTime,previous.changes));
    say('Listen, then move a boundary or correct a chord. Choose Done to save, or Cancel to discard changes.');
    openDialog('timelineEditorDialog');void select(index);
  };
  $('closeTimelineEditor').onclick=close;$('cancelTimelineEditor').onclick=cancel;
  dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopImmediatePropagation();cancel();},{capture:true});
  $('timelineEditorSeek').oninput=()=>{if(!editor)return;const time=Number($('timelineEditorSeek').value);audio.currentTime=time;void select(Math.max(0,chordIndexAt(time,editor.draft.changes)),time);};
  function navigate(index){
    if(!editor||busy||index<0||index>=editor.draft.changes.length)return;
    audio.currentTime=editor.draft.changes[index].time;$('timelineEditorSeek').value=audio.currentTime;void select(index);
  }
  $('timelineSection').onchange=()=>navigate(Number($('timelineSection').value));
  $('timelinePrevious').onclick=()=>{if(editor)navigate(editor.index-1);};
  $('timelineNext').onclick=()=>{if(editor)navigate(editor.index+1);};
  $('timelineRootButton').onclick=()=>{
    if(!editor||busy)return;
    $('timelineRootGrid').replaceChildren(...[...$('timelineRoot').options].map(option=>{
      const button=document.createElement('button');button.type='button';button.dataset.root=option.value;button.textContent=option.text;
      button.setAttribute('aria-pressed',String(option.value===$('timelineRoot').value));
      button.onclick=()=>{if(!editor||busy)return;$('timelineRoot').value=option.value;$('timelineRoot').dispatchEvent(new Event('change'));closeDialog('timelineRootPicker');};return button;
    }));openDialog('timelineRootPicker');
  };
  for(const id of ['timelineRoot','timelineQuality'])$(id).onchange=()=>{editor.draft.changes[editor.index].name=$('timelineRoot').value+$('timelineQuality').value;draw();say('Unsaved chord correction.');};
  $('timelineEarlier').onclick=()=>setTime(editor.draft.changes[editor.index].time-.1);
  $('timelineLater').onclick=()=>setTime(editor.draft.changes[editor.index].time+.1);
  $('undoTimelineChange').onclick=()=>{if(!editor)return;editor.draft=structuredClone(editor.previous);void select(Math.min(editor.index,editor.draft.changes.length-1));say('Unsaved changes undone.');};
  $('addTimelineChange').onclick=()=>{if(!editor)return;const time=Math.round(audio.currentTime*100)/100;if(time>=editor.duration||editor.draft.changes.some(c=>Math.abs(c.time-time)<.02)){say('Move playback to a different time before adding a chord.');return;}editor.draft.changes.push({time,name:$('timelineRoot').value+$('timelineQuality').value});editor.draft.changes.sort((a,b)=>a.time-b.time);void select(editor.draft.changes.findIndex(c=>c.time===time));};
  $('splitTimelineBar').onclick=()=>{
    if(!editor||busy)return;const time=splitTime();if(time===null)return;
    const name=editor.draft.changes[editor.index].name;
    editor.draft.changes.splice(editor.index+1,0,{time,name});
    navigate(editor.index+1);say('Split at '+stamp(time)+'. Choose the chord for this second part, then Done to save.');
  };
  $('deleteTimelineChange').onclick=()=>{if(!editor||editor.draft.changes.length<2)return;editor.draft.changes.splice(editor.index,1);void select(Math.min(editor.index,editor.draft.changes.length-1));};
  let dragging=false;
  svg.addEventListener('pointerdown',event=>{if(!editor||!event.target.hasAttribute('data-handle'))return;dragging=true;svg.setPointerCapture(event.pointerId);event.preventDefault();});
  svg.addEventListener('pointermove',event=>{if(!dragging||!editor)return;const bounds=svg.getBoundingClientRect();const x=(event.clientX-bounds.left)/bounds.width*740;setTime(editor.start+(x-12)/716*(editor.end-editor.start));});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(name,()=>dragging=false);
  $('hearTimelineChange').onclick=async()=>{
    if(previewEnd!==null){stopPreview();return;}if(!editor||busy)return;
    const start=editor.draft.changes[editor.index].time,end=Math.min(editor.duration,editor.draft.changes[editor.index+1]?.time??editor.duration);
    if(end<=start)return;
    const token=++previewToken;audio.currentTime=start;previewEnd=end;$('hearTimelineChange').textContent='■ Stop preview';
    say('Playing full section '+stamp(start)+' – '+stamp(end)+' · '+(end-start).toFixed(1)+' seconds.');
    try{await audio.play();if(token!==previewToken)return;previewTimer=setInterval(()=>{if(token===previewToken&&audio.currentTime>=end)stopPreview();},50);}
    catch(error){if(token===previewToken){stopPreview();say(error.message);}}
  };
  audio.addEventListener('timeupdate',()=>{if(editor)$('timelineEditorSeek').value=audio.currentTime;if(previewEnd!==null&&audio.currentTime>=previewEnd)stopPreview();});
  audio.addEventListener('ended',()=>{if(previewEnd!==null)stopPreview();});
  async function saveCorrections(current){
    const result=await request(`/${current.target.id}/chord-timeline`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioVersion:current.audioVersion,variant:current.target.variant,previous:current.previous,analysis:current.draft})});
    if(song?.id===current.owner&&song.audioVersion===current.audioVersion){
      if(current.target.variant==='simple')song.simpleChordAnalysis=result;else current.target.pdf.chordAnalysis=result;
      songs=songs.map(item=>item.id===current.target.id?{...item,[current.target.variant?'simpleChordAnalysis':'chordAnalysis']:result}:item);
      window.AutoPdfFollow?.timelineChanged(current.previous,result);
      window.SongChordMatch?.stop();stageDiagramName='';showPlayingChord(audio.currentTime);update();
    }
    if(editor===current){editor.previous=structuredClone(result);editor.draft=structuredClone(result);}
  }
  window.addEventListener('pagehide',()=>{waveRequest?.abort();stopPreview();});
})();
