// Run with Playwright available via NODE_PATH and GPL_TEST_CHROME set if needed.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="500" height="2000"><rect width="500" height="2000" fill="white"/></svg>';
// A small valid WAV recording, generated locally, is served as audio for the test.
let expectedChordNames=['G','C'],streamChord='G';
const samples=48000*20,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
const make=(id,cues)=>({id,title:cues.length?'With cues':'Without cues',pages:1,hasAudio:true,hasBacking:false,audioName:'test.wav',audioVersion:'test-audio',duration:20,notes:'',cues,updated:'test'});
const songs=[make('11111111-1111-1111-1111-111111111111',[{time:0,page:1,position:0,pageAnchor:0,label:'Intro',zoom:1}]),make('22222222-2222-2222-2222-222222222222',[])];
songs.push({...make('33333333-3333-3333-3333-333333333333',[]),title:'יוצא לאור',pages:2,cues:[{time:0,page:2,position:0,pageAnchor:0,label:'Intro',zoom:1}]});
songs.push({...make('44444444-4444-4444-4444-444444444444',[{time:5,page:2,position:.5,pageAnchor:.5,label:'Page two',zoom:1},{time:8,page:2,position:.8,pageAnchor:.8,label:'Later',zoom:1}]),title:'Continuous sheet',pageBreaks:[0,.4,1]});
songs[0].pages=2;
songs[0].cues.push({time:4,page:1,position:.6,label:'Middle',zoom:1});
songs[0].cues.push({time:5,page:2,position:0,pageAnchor:0,label:'Verse',zoom:1});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');

 if(url.pathname.endsWith('/waveform')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({bins:Array.from({length:160},(_,i)=>.3+.2*Math.sin(i))}));}
 if(url.pathname.endsWith('/chord-timeline')&&req.method==='PUT'){
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   const edit=JSON.parse(body);const target=songs.find(song=>url.pathname.includes(song.id));
   assert.equal(edit.audioVersion,'test-audio');
   const field=edit.variant==='simple'?'simpleChordAnalysis':'chordAnalysis';
   target[field]={...edit.analysis,corrected:true};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(target[field]));
  });return;
 }
 if(url.pathname==='/api/song-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(songs));}
 if([songs[0],songs[3]].some(song=>url.pathname==='/api/song-library/'+song.id+'/simple')){
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pages:2,updated:'simple-test'}));
 }
 if(url.pathname==='/api/song-library/'+songs[0].id&&req.method==='PUT'){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   songs[0].cues=JSON.parse(body).cues;
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(songs[0]));
  });
  return;
 }
 if(url.pathname==='/api/chord-practice/devices'){
  res.setHeader('Content-Type','application/json');
  return res.end(JSON.stringify({available:true,devices:['default']}));
 }
 if(url.pathname==='/api/chord-practice/listen-chords'){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   const {names,shift}=JSON.parse(body);
   assert.deepEqual(names,expectedChordNames);assert.equal(shift,2);
   res.setHeader('Content-Type','application/x-ndjson');
   res.write('{"chord":null}\n');
   const timer=setTimeout(()=>res.write(JSON.stringify({chord:streamChord})+'\n'),650);
   res.on('close',()=>clearTimeout(timer));
  });
  return;
 }
 if(url.pathname==='/api/chord-practice/record'){
  res.setHeader('Content-Type','application/octet-stream');let count=0;
  const send=()=>{const block=Buffer.alloc(2048);for(let i=0;i<1024;i++,count++){
   const t=count/16000,beat=Math.round((t-7.104)/1.5),since=t-(7.104+beat*1.5);
   const value=beat>=0&&beat<8&&since>=0&&since<.04?.28*Math.sin(2*Math.PI*180*since):0;
   block.writeInt16LE(Math.round(value*32767),i*2);
  }res.write(block);};send();const timer=setInterval(send,64);res.on('close',()=>clearInterval(timer));return;
 }
 if(url.pathname.endsWith('/rhythm/analyze')&&req.method==='POST'){
  res.setHeader('Content-Type','application/json');
  return res.end(JSON.stringify({estimate:{bpm:96,meter:null},audioVersion:'test-audio'}));
 }
 if(url.pathname.endsWith('/rhythm')&&req.method==='PUT'){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   const {audioVersion,rhythm}=JSON.parse(body);
   assert.equal(audioVersion,'test-audio');
   const selected=songs.find(song=>url.pathname.includes(song.id));
   selected.rhythm=rhythm;
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(selected));
  });
  return;
 }
 if(url.pathname.endsWith('/analyze-chords')){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   assert.equal(JSON.parse(body).shift,2);
   res.setHeader('Content-Type','application/json');
   const simple=JSON.parse(body).variant==='simple';
   res.end(JSON.stringify({shift:2,changes:[{time:0,name:simple?'Am':'G'},{time:4,name:simple?'F':'C'},{time:8,name:null}]}));
  });
  return;
 }
 if(url.pathname.endsWith('/chords')){
  res.setHeader('Content-Type','application/json');
  return res.end(JSON.stringify([{number:1,chords:[{name:'G',x:.2,y:.05,width:.03,height:.01},{name:'C',x:.4,y:.05,width:.03,height:.01}]}]));
 }
 if(url.pathname.includes('33333333-3333-3333-3333-333333333333/page/1')){
  setTimeout(()=>{res.setHeader('Content-Type','image/svg+xml');res.end(sheet);},500);
  return;
 }
 if(url.pathname.includes('/page/')){res.setHeader('Content-Type','image/svg+xml');return res.end(sheet);}
 if(url.pathname.endsWith('/audio')){
  res.setHeader('Content-Type','audio/wav');
  res.setHeader('Accept-Ranges','bytes');
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(!range)return res.end(wav);
  const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${wav.length}`,'Content-Length':end-start+1});
  return res.end(wav.subarray(start,end+1));
 }
 const name=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!name.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(!fs.existsSync(name)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(name));
});

songs[0].rhythm={bpm:100,meter:'4/4',firstDownbeat:0};
songs[0].chordAnalysis={shift:0,changes:[{time:0,name:'G'},{time:8,name:'C'}]};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 const screenshots=path.resolve(__dirname,'../../outputs/Practice-Upgrade');fs.mkdirSync(screenshots,{recursive:true});
 const checks=[];function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS',name);}
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});
  const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('guitar-song-count-in','false');localStorage.setItem('guitar-reading-view','full');localStorage.setItem('guitar-last-song','11111111-1111-1111-1111-111111111111');});
  await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);
  await page.waitForFunction(()=>document.querySelector('#audio').src.includes('/audio'));
  await page.locator('#audio').evaluate(a=>a.pause());
  check('clean view is the default and gives the PDF the full width',await page.locator('.companion').isHidden()&&await page.locator('#stagePlay').isVisible()&&await page.locator('#pdfViewport').evaluate(e=>e.getBoundingClientRect().width>760));
  await page.locator('#audio').evaluate(a=>{a.currentTime=8;});
  await page.locator('#stageBack').tap();
  check('clean Back button moves five seconds without starting playback',await page.locator('#audio').evaluate(a=>a.currentTime===3&&a.paused));
  await page.locator('#stageForward').tap();
  check('clean Forward button moves five seconds',await page.locator('#audio').evaluate(a=>a.currentTime===8));
  await page.locator('#stageVolume').evaluate(e=>{e.value='35';e.dispatchEvent(new Event('input',{bubbles:true}));});
  check('clean volume slider controls song volume and syncs Tools',await page.locator('#audio').evaluate(a=>Math.abs(a.volume-.35)<.001&&!a.muted)&&await page.locator('#toolsVolume').inputValue()==='35');
  await page.locator('#stageMute').tap();check('clean speaker button mutes the song',await page.locator('#audio').evaluate(a=>a.muted));
  await page.locator('#stageMute').tap();
  check('transport and volume fit on one row',await page.evaluate(()=>{
   const ids=['stageBack','stagePlay','stageForward','stageSeek','stageVolume','readerControlsToggle'];const rects=ids.map(id=>document.getElementById(id).getBoundingClientRect());
   return rects.every(r=>r.left>=0&&r.right<=800)&&Math.max(...rects.map(r=>r.y+r.height/2))-Math.min(...rects.map(r=>r.y+r.height/2))<3;
  }));
  await page.locator('#audio').evaluate(a=>{a.currentTime=0;});
  await page.waitForFunction(()=>document.querySelector('.clean-chord-bars'));
  check('clean bars use chord cards and progress pills instead of numbered dots',await page.locator('#stageBeatGraphic circle').count()===0&&await page.locator('.clean-beat-pill').count()>0&&await page.locator('.clean-chord-line strong').count()>0);
  const originalDiagram=await page.evaluate(()=>({analysis:structuredClone(song.chordAnalysis),pages:song.pages}));
  expectedChordNames=['G','C','D'];
  await page.evaluate(()=>{song.pages=1;song.chordAnalysis={shift:2,changes:[{time:0,name:'G'},{time:2.4,name:'C'},{time:3.6,name:'D'}]};update();showPlayingChord(0);document.querySelector('#chordMatchButton').click();});
  await page.waitForFunction(()=>!document.querySelector('#startChordMatch').disabled);await page.locator('#startChordMatch').tap();
  await page.waitForFunction(()=>document.querySelector('.clean-chord-segment.matched'));
  check('the preview-style current card turns green when the guitar matches',await page.locator('.clean-chord-segment.matched strong').first().textContent()==='G');
  check('two chords divide the upcoming bar into equal halves',await page.locator('.clean-bar').nth(1).locator('[data-bar-fraction="0.5"]').count()===2);
  await page.locator('#stageBeats').screenshot({path:path.join(screenshots,'04-clean-chord-cards.png')});
  await page.screenshot({path:path.join(screenshots,'01-clean-player.png')});
  await page.locator('#audio').evaluate(a=>{a.pause();a.dispatchEvent(new Event('ended'));});
  await page.waitForFunction(()=>document.querySelector('#chordMatchDialog').classList.contains('match-results'));
  check('final score shows two large cards without setup controls',await page.locator('#matchAccuracyPercent').textContent()==='33%'&&await page.locator('#matchTimingPercent').textContent()==='0%'&&await page.locator('#chordMatchSetup').isHidden());
  check('final score and replay button fit without scrolling',await page.locator('#chordMatchDialog .dialogbody').evaluate(e=>e.scrollHeight<=e.clientHeight+1)&&await page.locator('#startChordMatch').evaluate(e=>e.getBoundingClientRect().bottom<=480));
  await page.locator('#chordMatchDialog').screenshot({path:path.join(screenshots,'05-chord-match-results.png')});
  await page.locator('#matchSetupButton').tap();
  check('results Settings returns to microphone selection',await page.locator('#chordMatchSetup').isVisible()&&await page.locator('#chordMatchDevice').isVisible());
  await page.locator('#chordMatchDialog [data-close]').tap();await page.locator('#toolsDialog [data-close]').tap();
  await page.evaluate(original=>{window.SongChordMatch.stop();audio.pause();song.chordAnalysis=original.analysis;song.pages=original.pages;audio.currentTime=0;showPlayingChord(0);update();},originalDiagram);
  expectedChordNames=['G','C'];
  check('Follow is absent from the clean playback row',await page.locator('#stageFollow').count()===0&&await page.locator('#follow').isHidden());
  check('clean view hides the redundant toggle and exposes Chord Focus directly',await page.locator('#readerToggle').isHidden()&&await page.locator('#chordFocusToggle').isVisible());
  await page.locator('#chordFocusToggle').tap();
  check('direct Chord Focus replaces the PDF and keeps bars and transport visible',await page.locator('#pdfViewport').isHidden()&&await page.locator('#fullscreenChords').isVisible()&&await page.locator('#stageBeats').isVisible()&&await page.locator('#stagePlay').isVisible()&&await page.locator('#readerBottom').evaluate(e=>e.getBoundingClientRect().bottom<=480));
  await page.locator('#readerControlsToggle').tap();
  check('Chord Focus hides Follow even when Controls is open',await page.locator('#follow').isHidden());
  await page.locator('#readerControlsToggle').tap();
  await page.locator('#chordFocusToggle').tap();
  await page.evaluate(()=>{song.hasBacking=true;audio.pause();audio.currentTime=6;update();});
  check('track and rhythm buttons stay hidden with controls closed',await page.locator('#stageTrack').isHidden()&&await page.locator('#stageSetRhythm').isHidden());
  await page.locator('#readerControlsToggle').tap();
  check('upper track switch appears beside rhythm only with controls open',await page.locator('#stageTrack').isVisible()&&await page.locator('#stageTrack').isEnabled()&&await page.locator('#stageSetRhythm').isVisible());
  check('track selection is separate from the three adjacent rhythm controls',await page.evaluate(()=>{const track=document.querySelector('#stageTrack'),group=document.querySelector('#rhythmButtons'),buttons=[...group.querySelectorAll('button')];return track.parentElement!==group&&buttons.map(b=>b.id).join(',')==='stageSyncBar,addRhythmPoint,stageSetRhythm'&&buttons[0].getBoundingClientRect().left-track.getBoundingClientRect().right>=12;}));
  await page.locator('#stageTrack').tap();await page.waitForFunction(()=>document.querySelector('#stageTrack').textContent==='Backing'&&!document.querySelector('#stageTrack').disabled);
  check('upper track switch keeps playback position and updates classic controls',await page.locator('#readerTrack').textContent()==='Backing'&&await page.locator('#trackToggle').textContent().then(t=>t.startsWith('Backing'))&&await page.locator('#audio').evaluate(a=>a.paused&&Math.abs(a.currentTime-6)<.1));
  await page.locator('#stageTrack').tap();await page.waitForFunction(()=>document.querySelector('#stageTrack').textContent==='Original'&&!document.querySelector('#stageTrack').disabled);
  await page.evaluate(()=>{song.hasBacking=false;update();});check('upper track switch disables when no backing is attached',await page.locator('#stageTrack').isDisabled());
  await page.locator('#readerControlsToggle').tap();
  check('hiding controls also hides track and rhythm buttons',await page.locator('#stageTrack').isHidden()&&await page.locator('#stageSetRhythm').isHidden()&&await page.locator('#stageSyncBar').isHidden()&&await page.locator('#addRhythmPoint').isHidden());
  check('PDF View returns to the clean sheet without another mode toggle',await page.locator('#pdfViewport').isVisible()&&await page.locator('#fullscreenChords').isHidden()&&await page.locator('#readerToggle').isHidden());
  check('the clean screen fits at 800 by 480',await page.evaluate(()=>document.documentElement.scrollWidth<=800&&document.documentElement.scrollHeight<=480&&document.querySelector('#readerBottom').getBoundingClientRect().bottom<=480));
  await page.locator('#readerControlsToggle').tap();
  check('the small Controls button reveals Follow, zoom and chord tools',await page.locator('#follow').isVisible()&&await page.locator('#zoomIn').isVisible()&&await page.locator('#chordListButton').isVisible());
  await page.locator('#cuesButton').tap();await page.locator('#recordFollow').tap();
  await page.waitForFunction(()=>!document.querySelector('#audio').paused);
  check('clean view exposes the recording scroll arrow',await page.locator('#readerFollowDown').isVisible()&&await page.locator('#readerBottom').evaluate(e=>e.getBoundingClientRect().bottom<=480));
  await page.locator('#readerFollowDown').tap();await page.locator('#stopRecordFollow').tap();
  await page.locator('#recordFollowReview [data-close]').tap();
  await page.locator('#readerControlsToggle').tap();
  await page.locator('#toolsButton').tap();await page.locator('#toolsTabAudio').tap();
  check('audio selection and volume remain available in Tools',await page.locator('#originalTrack').isVisible()&&await page.locator('#toolsVolume').isVisible());
  await page.locator('#toolsTabAnalyze').tap();await page.locator('#editChordTimeline').tap();
  await page.waitForFunction(()=>document.querySelector('#timelineEditorGraphic line'));
  await page.screenshot({path:path.join(screenshots,'02-timeline-editor.png')});
  check('timeline editor fits without hiding Done',await page.locator('#closeTimelineEditor').evaluate(e=>e.getBoundingClientRect().bottom<=480));
  const originalCues=JSON.stringify(songs[0].cues);
  await page.locator('#timelineRootButton').tap();await page.locator('#timelineRootGrid [data-root="E"]').tap();await page.locator('#timelineQuality').selectOption('m');
  await page.locator('#timelineSection').selectOption('1');await page.locator('#timelineEarlier').tap();
  check('a boundary can move earlier in 0.1 second steps',await page.locator('#timelineStart').textContent()==='0:07.90');
  await page.locator('#closeTimelineEditor').tap();await page.waitForFunction(()=>!document.querySelector('#timelineEditorDialog').open&&!busy);await page.locator('#editChordTimeline').tap();
  check('corrected names and times save to the active timeline',songs[0].chordAnalysis.changes[0].name==='Em'&&songs[0].chordAnalysis.changes[1].time===7.9&&songs[0].chordAnalysis.corrected);
  check('separate Save button removed',await page.locator('#saveTimelineChanges').count()===0);
  await page.locator('#timelineEditorSeek').evaluate(e=>{e.value='3';e.dispatchEvent(new Event('input'));});
  await page.locator('#addTimelineChange').tap();await page.locator('#timelineRootButton').tap();await page.locator('#timelineRootGrid [data-root="D"]').tap();await page.locator('#timelineQuality').selectOption('');
  await page.locator('#closeTimelineEditor').tap();await page.waitForFunction(()=>!document.querySelector('#timelineEditorDialog').open&&!busy);await page.locator('#editChordTimeline').tap();
  check('a missed chord can be inserted at the playhead',songs[0].chordAnalysis.changes.length===3&&songs[0].chordAnalysis.changes[1].name==='D'&&songs[0].chordAnalysis.changes[1].time===3);
  await page.locator('#deleteTimelineChange').tap();await page.locator('#undoTimelineChange').tap();
  check('Undo restores a deleted chord before saving',await page.locator('#timelineSection option').count()===3);
  check('timeline saving preserves recorded Follow',JSON.stringify(songs[0].cues)===originalCues);
  await page.locator('#closeTimelineEditor').tap();
  await page.locator('#toolsTabPractice').tap();await page.locator('#timingCalibrationButton').tap();
  await page.waitForFunction(()=>!document.querySelector('#startTimingCalibration').disabled);
  await page.screenshot({path:path.join(screenshots,'03-calibration.png')});
  check('calibration fits and presents an adjustable result',await page.locator('#applyTimingCalibration').evaluate(e=>e.getBoundingClientRect().bottom<=480)&&await page.locator('#calibrationOffset').textContent()==='+0 ms');
  await page.locator('#calibrationPlus').tap();await page.locator('#applyTimingCalibration').tap();
  check('manual timing adjustment saves per microphone',await page.evaluate(()=>GuitarTimingAdjustment.get(document.querySelector('#calibrationDevice').value)===10));
  await page.locator('#startTimingCalibration').tap();
  await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('Get ready'));
  check('calibration starts with a slow four-beat get-ready count',await page.locator('#calibrationTempo').inputValue()==='40'&&await page.locator('#calibrationBeats .done').count()===0);
  await page.waitForFunction(()=>document.querySelector('#calibrationStatus').textContent.includes('strums measured'),{},{timeout:30000});
  check('eight guitar attacks produce a real timing suggestion',await page.locator('#calibrationBeats .done').count()>=4&&await page.locator('#calibrationSuggestion').textContent().then(text=>text.includes('ms')));
  await page.locator('#applyTimingCalibration').tap();
  const measured=await page.evaluate(()=>GuitarTimingAdjustment.get(document.querySelector('#calibrationDevice').value));
  check('the measured adjustment replaces the previous manual value',measured>50&&measured<250);
  await page.locator('#closeTimingCalibration').tap();
  await page.locator('#toolsTabPlayback').tap();
  await page.locator('#audio').evaluate(a=>{a.currentTime=3;});await page.locator('#setA').tap();
  await page.locator('#audio').evaluate(a=>{a.currentTime=7;});await page.locator('#setB').tap();await page.locator('#toolsLoopToggle').tap();
  check('A/B looping and jump controls are available without the sidebar',await page.locator('#toolsLoopToggle').textContent()==='Loop on'&&await page.locator('#toolsBack').isVisible()&&await page.locator('#toolsForward').isVisible());
  check('Playback settings fit with the layout switch',await page.locator('#toolsPlayback').evaluate(e=>e.scrollHeight<=e.clientHeight+1));
  await page.locator('#cleanSongLayout').uncheck();await page.locator('#toolsDialog [data-close]').tap();
  check('classic split controls remain available',await page.locator('.companion').isVisible());
  await page.locator('#readerToggle').tap();
  check('classic FullScreen and Split view toggle remains available',await page.locator('#readerToggle').textContent()==='Split view'&&await page.locator('.companion').isHidden());
  await page.locator('#readerToggle').tap();
  check('no JavaScript errors',errors.length===0);
  console.log(`${checks.length} practice upgrade browser checks passed.`);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
