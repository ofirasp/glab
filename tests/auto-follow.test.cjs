// Run with Playwright available via NODE_PATH and GPL_TEST_CHROME set if needed.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="500" height="2000"><rect width="500" height="2000" fill="white"/></svg>';
// A small valid WAV recording, generated locally, is served as audio for the test.
const samples=48000*20,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
const make=(id,cues)=>({id,title:cues.length?'With cues':'Without cues',pages:1,hasAudio:true,hasBacking:false,audioName:'test.wav',duration:20,notes:'',cues,updated:'test'});
const songs=[make('11111111-1111-1111-1111-111111111111',[{time:0,page:1,position:0,pageAnchor:0,label:'Intro',zoom:1}]),make('22222222-2222-2222-2222-222222222222',[])];
songs.push({...make('33333333-3333-3333-3333-333333333333',[]),title:'יוצא לאור',pages:2,cues:[{time:0,page:2,position:0,pageAnchor:0,label:'Intro',zoom:1}]});
songs.push({...make('44444444-4444-4444-4444-444444444444',[{time:5,page:2,position:.5,pageAnchor:.5,label:'Page two',zoom:1},{time:8,page:2,position:.8,pageAnchor:.8,label:'Later',zoom:1}]),title:'Continuous sheet',pageBreaks:[0,.4,1]});
songs[0].pages=2;
songs[0].cues.push({time:4,page:1,position:.6,label:'Middle',zoom:1});
songs[0].cues.push({time:5,page:2,position:0,pageAnchor:0,label:'Verse',zoom:1});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/song-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(songs));}
 if(url.pathname==='/api/song-library/'+songs[0].id+'/simple'){
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
   assert.deepEqual(names,['G','C']);assert.equal(shift,2);
   res.setHeader('Content-Type','application/x-ndjson');
   const send=()=>res.write('{"chord":"G"}\n');
   send();const timer=setInterval(send,90);
   res.on('close',()=>clearInterval(timer));
  });
  return;
 }
 if(url.pathname==='/api/chord-practice/record'){
  res.setHeader('Content-Type','application/octet-stream');
  res.write(Buffer.alloc(2048));
  const timer=setInterval(()=>res.write(Buffer.alloc(2048)),64);
  res.on('close',()=>clearInterval(timer));
  return;
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
   songs[0].rhythm=rhythm;
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify(songs[0]));
  });
  return;
 }
 if(url.pathname.endsWith('/analyze-chords')){
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   assert.equal(JSON.parse(body).shift,2);
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({shift:2,changes:[{time:0,name:'G'},{time:4,name:'C'},{time:8,name:null}]}));
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
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const checks=[];const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);console.log('PASS',name);};
 try{
 browser=await chromium.launch({headless:true,...(process.env.GPL_TEST_CHROME?{executablePath:process.env.GPL_TEST_CHROME}:{})});
 const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.testScreenLocks=0;
  Object.defineProperty(navigator,'wakeLock',{value:{async request(){
   window.testScreenLocks++;
   const sentinel=new EventTarget();
   sentinel.release=async()=>{window.testScreenLocks--;sentinel.dispatchEvent(new Event('release'));};
   return sentinel;
  }}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);
 const openSong=async title=>{if(!await page.locator('#libraryDialog').isVisible())await page.locator('#libraryButton').tap();await page.locator('.songrow').filter({hasText:title}).getByRole('button',{name:'Open',exact:true}).tap();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);};
 const isOn=()=>page.locator('#follow').getAttribute('aria-pressed').then(v=>v==='true');
 await openSong('With cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('song title sits between Tools and FullScreen',await page.locator('#songTitle').evaluate(title=>
  title.previousElementSibling.id==='toolsButton'&&title.compareDocumentPosition(document.querySelector('#readerToggle'))&Node.DOCUMENT_POSITION_FOLLOWING));
 check('track switch is at least 44 pixels tall',await page.locator('#trackToggle').evaluate(button=>button.getBoundingClientRect().height>=44));
 await page.locator('#audio').evaluate(a=>{a.currentTime=3;});
 await page.getByRole('button',{name:'Go to start'}).tap();
 check('the progress button returns playback to the start',await page.locator('#audio').evaluate(a=>a.currentTime<.4&&!a.paused));
 check('autoplay enables Follow for a song with cues',await isOn());
 await page.waitForFunction(()=>window.testScreenLocks===1);
 check('song playback holds a screen wake lock',await page.evaluate(()=>window.testScreenLocks===1));
 const simple=page.getByRole('switch',{name:'Simple version'});
 const simplePage=page.waitForResponse(r=>r.url().includes('/page/1?')&&r.url().includes('variant=simple'));
 await simple.tap();await simplePage;
 check('switching to simple keeps Follow on',await isOn()&&await page.locator('#follow').isEnabled());
 await page.waitForFunction(()=>document.querySelector('#pageLoading').hidden);
 await page.locator('#audio').evaluate(a=>a.pause());
 await page.waitForFunction(()=>window.testScreenLocks===0);
 check('pausing releases the screen wake lock',await page.evaluate(()=>window.testScreenLocks===0));
 await page.locator('#audio').evaluate(a=>a.currentTime=2);
 await page.waitForFunction(()=>{
  const pane=document.querySelector('#pdfViewport');
  return Math.abs(pane.scrollTop/(pane.scrollHeight-pane.clientHeight)-0.3)<.02;
 });
 const scrollFraction=await page.locator('#pdfViewport').evaluate(pane=>pane.scrollTop/(pane.scrollHeight-pane.clientHeight));
 check('halfway through same-page cues scrolls halfway to the next position',Math.abs(scrollFraction-.3)<.02);
 await page.locator('#audio').evaluate(a=>a.currentTime=4.5);
 await page.waitForFunction(()=>{
  const pane=document.querySelector('#pdfViewport');
  return Math.abs(pane.scrollTop/(pane.scrollHeight-pane.clientHeight)-0.8)<.02;
 });
 const pageEndFraction=await page.locator('#pdfViewport').evaluate(pane=>pane.scrollTop/(pane.scrollHeight-pane.clientHeight));
 check('follow scrolls toward the page bottom before turning',Math.abs(pageEndFraction-.8)<.02);
 const nextCuePage=page.waitForResponse(r=>r.url().includes('/page/2?')&&r.url().includes('variant=simple'));
 await page.locator('#audio').evaluate(a=>a.currentTime=6);await nextCuePage;
 check('following a later cue loads the simple PDF page',await page.locator('#pageNumber').textContent().then(t=>t.startsWith('2 / 2')));
 const standardPage=page.waitForResponse(r=>r.url().includes('/page/2?')&&!r.url().includes('variant=simple'));
 await simple.tap();await standardPage;
 check('switching back keeps Follow on and seeks to the same cue',await isOn());
 await page.locator('#audio').evaluate(a=>a.play());
 await page.locator('#follow').tap();check('manual off still works during playback',!await isOn());
 await page.locator('#play').tap();await page.locator('#play').tap();await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');
 check('pause and resume enables Follow again',await isOn());
 await page.locator('#follow').tap();await page.locator('#readerToggle').tap();
 check('FullScreen starts with both control panels collapsed',await page.locator('#readerPlay').isHidden()&&await page.locator('#follow').isHidden()&&await page.locator('#readerMute').isHidden()&&await page.locator('#zoomIn').isHidden());
 await page.locator('#readerControlsToggle').tap();
 check('Controls reveals zoom, cue, playback and volume rows',await page.locator('#follow').isVisible()&&await page.locator('#readerPlay').isVisible()&&await page.locator('#readerMute').isVisible()&&await page.locator('#zoomIn').isVisible());
 await page.locator('#readerControlsToggle').tap();check('Hide controls collapses the panel again',await page.locator('#readerPlay').isHidden());
 await page.locator('#readerControlsToggle').tap();
 await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('reading view Play enables Follow',await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#follow').tap();await page.locator('#readerTools').tap();
 const panel=()=>page.locator('#toolsDialog [role="tabpanel"]:visible');
 for(const name of ['Audio','Playback','Practice','Files']){
  await page.getByRole('tab',{name,exact:true}).tap();
  check(`Song tools ${name} tab fits without scrolling`,await panel().evaluate(p=>p.scrollHeight<=p.clientHeight&&p.scrollWidth<=p.clientWidth));
 }
 check('Song tools uses the footer space for tab content',await page.locator('#toolsDialog .dialogfoot').count()===0);
 await page.locator('#toolsDialog [data-close]').tap();
 await openSong('Without cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);check('songs without cues keep Follow off',!await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();check('no-cue resume stays off',!await isOn());
 await openSong('With cues');await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('returning to a cued song enables Follow',await isOn());
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);await page.locator('#readerControlsToggle').tap();
 check('restoring last song does not autoplay',await page.locator('#audio').evaluate(a=>a.paused));
 await page.locator('#readerPlay').tap();await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('Play after browser reload enables Follow',await isOn());
 await page.locator('#readerTools').tap();await page.locator('#toolsTabPractice').tap();await page.locator('#rhythmButton').tap();await page.locator('#analyzeRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('No consistent 3/4 or 4/4 pattern found'));
 check('uncertain meter leaves the selector blank',await page.locator('#rhythmBpm').inputValue()==='96'&&await page.locator('#rhythmMeter').inputValue()==='');
 await page.locator('#rhythmMeter').selectOption('6/8');await page.locator('#previewRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Playing two bars over the song'));
 check('click preview keeps the song playing',await page.locator('#audio').evaluate(a=>!a.paused));
 await page.locator('#previewRhythm').tap();
 check('stopping the clicks leaves the song playing',await page.locator('#previewRhythm').textContent()==='Preview clicks'&&await page.locator('#audio').evaluate(a=>!a.paused));
 await page.locator('#saveRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Rhythm saved'));
 check('edited rhythm is saved with the current audio version',songs[0].rhythm.bpm===96&&songs[0].rhythm.meter==='6/8');
 await page.locator('#rhythmDialog [data-close]').tap();
 await page.locator('#readerTools').tap();
 check('saved meter and tempo appear in song tools',await page.locator('#rhythmSummary').textContent()==='6/8 · 96 BPM');
 await page.locator('#toolsDialog [data-close]').tap();
 await openSong('יוצא לאור');
 const edge=()=>page.locator('#pdfViewport').evaluate(p=>({left:p.scrollLeft,right:p.scrollWidth-p.clientWidth}));
 let position=await edge();
 check('Hebrew autoplay and its opening cue land at the right edge',position.right>0&&Math.abs(position.left-position.right)<=1);
 await page.locator('#zoomIn').tap();
 position=await edge();
 check('Hebrew right edge stays pinned when zooming',position.right>0&&Math.abs(position.left-position.right)<=1);
 await page.locator('#previous').tap();await page.waitForFunction(()=>document.querySelector('#pageLoading').hidden);
 position=await edge();
 check('Hebrew page turn preserves the right edge',position.right>0&&Math.abs(position.left-position.right)<=1);
 await page.locator('#pdfViewport').evaluate(p=>{p.scrollLeft=0;});
 await page.locator('#zoomIn').tap();
 check('manual horizontal scroll remains usable in Hebrew songs',(await edge()).left===0);
 await page.locator('#audio').evaluate(a=>a.pause());
 await page.locator('#readerPlay').tap();
 await page.waitForFunction(()=>{
  const pane=document.querySelector('#pdfViewport');
  return !document.querySelector('#audio').paused&&document.querySelector('#pageLoading').hidden
    &&Math.abs(pane.scrollWidth-pane.clientWidth-pane.scrollLeft)<=1;
 });
 position=await edge();
 check('pressing Play resets a Hebrew song to the right edge',position.right>0&&Math.abs(position.left-position.right)<=1);
 await openSong('Without cues');
 check('other songs open at the left edge after a Hebrew song',(await edge()).left===0);
 await page.locator('#audio').evaluate(a=>a.pause());
 await page.locator('#pdfViewport').evaluate(p=>{p.scrollLeft=p.scrollWidth;});
 await page.locator('#readerPlay').tap();
 await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#pdfViewport').scrollLeft===0);
 check('pressing Play resets other songs to the left edge',(await edge()).left===0);
 await openSong('With cues');
 await page.locator('#cuesButton').tap();
 await page.locator('#recordFollow').tap();
 check('recording keeps audio playing with Follow off',!await isOn()&&await page.locator('#audio').evaluate(a=>!a.paused));
 await page.locator('#audio').evaluate(a=>{a.currentTime=2;});
 const down=page.locator('#readerFollowDown');
 const scrollTop=()=>page.locator('#pdfViewport').evaluate(p=>p.scrollTop);
 const originalTop=await scrollTop();
 await down.tap();
 check('a tap makes a small scroll step',await scrollTop()-originalTop<=38);
 await down.tap();
 check('two quick down taps scroll without making two marks',await scrollTop()>originalTop&&await page.locator('#stopRecordFollow').textContent().then(t=>t.endsWith('· 1')));
 const box=await down.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 const heldTop=await scrollTop();
 await page.waitForTimeout(550);
 check('holding the down arrow keeps scrolling and defers the mark',await scrollTop()>heldTop&&await scrollTop()-heldTop<=32&&await page.locator('#stopRecordFollow').textContent().then(t=>t.endsWith('· 1')));
 await page.mouse.up();
 await page.waitForTimeout(400);
 check('the down-arrow marks wait for one second after release',await page.locator('#stopRecordFollow').textContent().then(t=>t.endsWith('· 1')));
 await page.waitForFunction(()=>document.querySelector('#stopRecordFollow').textContent.endsWith('· 2'));
 await page.locator('#audio').evaluate(a=>{a.currentTime=3;});
 await page.locator('#next').tap();
 await page.waitForFunction(()=>document.querySelector('#stopRecordFollow').textContent.endsWith('· 3'));
 await page.locator('#stopRecordFollow').tap();
 check('stop pauses and opens review with scroll and page marks',await page.locator('#recordFollowList .cuerow').count()===3&&await page.locator('#audio').evaluate(a=>a.paused));
 await page.getByRole('button',{name:/Remove Follow 3/}).tap();
 await page.locator('#saveRecordedFollow').tap();
 await page.waitForFunction(()=>!document.querySelector('#recordFollowReview').open);
 check('saving merges kept marks and preserves existing cues',songs[0].cues.length===4&&songs[0].cues.some(cue=>cue.label==='Intro')&&songs[0].cues.some(cue=>cue.label==='Follow 2'&&cue.page===1&&cue.pageAnchor>0));
 await page.locator('#readerPlay').tap();await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');
 check('saved recording is available for Follow playback',await isOn());
 await openSong('Continuous sheet');
 check('continuous sheets hide page arrows',await page.locator('#previous').isHidden()&&await page.locator('#next').isHidden());
 await page.locator('#audio').evaluate(a=>a.pause());
 await page.locator('#cuesButton').tap();
 await page.getByRole('button',{name:/Page two · page 2/}).tap();
 check('an original page-two cue jumps within the continuous sheet',await page.evaluate(()=>{
  const pane=document.querySelector('#pdfViewport'),image=document.querySelector('#pdfImage');
  return Math.abs(pane.scrollTop/image.clientHeight-.7)<.01;
 }));
 await page.locator('#markCue').tap();
 check('marking on the continuous sheet keeps original cue coordinates',(await page.locator('#markSummary').textContent()).includes('PDF page 2'));
 await page.locator('#markDialog [data-close]').tap();
 await page.locator('#readerTools').tap();await page.locator('#recordReviewButton').tap();
 await page.waitForFunction(()=>!document.querySelector('#startTake').disabled);
 await page.locator('#recordReviewCue').selectOption({label:'0:05 · Page two'});
 await page.locator('#startTake').tap();
 await page.waitForFunction(()=>document.querySelector('#takeRecordingStatus').textContent.includes('Recording'));
 check('recording dismisses the popup and exposes the top Stop button',await page.locator('#recordReviewDialog').isHidden()&&await page.locator('#stopTake').isVisible());
 const beforeScroll=await page.locator('#pdfViewport').evaluate(p=>p.scrollTop);
 await page.waitForFunction(y=>document.querySelector('#pdfViewport').scrollTop>y+8,beforeScroll);
 check('Follow scrolls the PDF automatically from the take playback clock',await isOn()&&await page.locator('#audio').evaluate(a=>a.paused));
 await page.locator('#stopTake').tap();
 check('Stop opens the review popup again',await page.locator('#recordReviewDialog').isVisible());
 check('Record & Review produces a downloadable WAV',await page.locator('#downloadTake').evaluate(async link=>{
  const bytes=new Uint8Array(await (await fetch(link.href)).arrayBuffer());
  return bytes.length>44&&String.fromCharCode(...bytes.slice(0,4))==='RIFF';
 }));
 await page.locator('#reviewGuitar').tap();
 await page.waitForFunction(()=>document.querySelector('#recordReviewStatus').textContent.includes('Playing your guitar take'));
 await page.locator('#reviewGuitar').tap();
 await page.locator('#reviewMix').tap();
 await page.waitForFunction(()=>document.querySelector('#recordReviewStatus').textContent.includes('Playing your take with the song track'));
 check('guitar-only and mixed review both play',true);
 await page.locator('#recordReviewDialog [data-close]').tap();
 await page.locator('#readerTools').tap();await page.locator('#analyzeChordsButton').tap();
 await page.locator('#chordAnalysisShift').selectOption('2');await page.locator('#runChordAnalysis').tap();
 await page.waitForFunction(()=>document.querySelector('#chordAnalysisStatus').textContent.includes('Saved 2'));
 await page.locator('#analyzeChordsDialog [data-close]').tap();
 await page.locator('#audio').evaluate(a=>{a.currentTime=1;});
 await page.waitForFunction(()=>document.querySelector('#playingChord').textContent==='G');
 await page.locator('#readerControlsToggle').tap();
 check('FullScreen chord strip replaces the title even with controls hidden',await page.locator('.top #playingChord').isVisible()
  &&await page.locator('#songTitle').isHidden()&&await page.locator('#pageNumber').isHidden());
 await page.locator('#readerToggle').tap();
 check('the chord strip is on the same row as the zoom readout',await page.locator('#playingChord').evaluate(badge=>{
  const chord=badge.getBoundingClientRect(),zoom=document.querySelector('#pageNumber').getBoundingClientRect();
  return Math.abs(chord.y+chord.height/2-zoom.y-zoom.height/2)<2;
 })&&await page.locator('#chordTargets .playing-chord').count()===0);
 check('zoom readout sits beside the zoom buttons',await page.locator('#pageNumber').evaluate(readout=>readout.nextElementSibling.id==='zoomOut'));
 await page.locator('#readerToggle').tap();
 await page.locator('#readerControlsToggle').tap();
 const centered=()=>page.locator('#playingChord').evaluate(badge=>{
  const chord=badge.getBoundingClientRect(),strip=badge.parentElement.getBoundingClientRect();
  return Math.abs(chord.x+chord.width/2-strip.x-strip.width/2)<2;
 });
 check('the current chord starts in the center',await centered());
 await page.locator('#audio').evaluate(a=>{a.currentTime=3;});
 await page.waitForFunction(()=>document.querySelector('#clock').textContent.startsWith('0:03'));
 check('the current chord stays centered as the song advances',await centered());
 check('the next chord moves equal distances near and far from center',await page.evaluate(()=>{
  const center=document.querySelector('#chordStrip').clientWidth/2;
  const positions=[1,1.5,3.4,3.9].map(time=>{
   showPlayingChord(time);
   return parseFloat(document.querySelector('#chordStrip .strip-chord:not(.past)').style.left);
  });
  return Math.abs((positions[0]-positions[1])-(positions[2]-positions[3]))<.01
    &&positions[3]>center&&positions[3]-center<40;
 }));
 check('a distant next chord is shown immediately within the strip',await page.evaluate(()=>{
  const previous=song.chordAnalysis;
  song.chordAnalysis={shift:0,changes:[{time:0,name:'G'},{time:45,name:'Am'},{time:90,name:'C'}]};
  showPlayingChord(0);
  const strip=document.querySelector('#chordStrip'),next=strip.querySelector('.next');
  const ready=next?.textContent==='Am'&&parseFloat(next.style.left)<strip.clientWidth;
  song.chordAnalysis=previous;
  showPlayingChord(audio.currentTime);
  return ready;
 }));
 await page.locator('#audio').evaluate(a=>{a.currentTime=5;});
 await page.waitForFunction(()=>document.querySelector('#playingChord').textContent==='C');
 check('the previous chord stays visible on the left when there is room',await page.locator('#chordStrip .past').first().textContent()==='G');
 await page.evaluate(()=>{
  const previous=song.chordAnalysis;
  song.chordAnalysis={...previous,changes:Array.from({length:12},(_,i)=>({time:1+i*1.1,name:['G','C','D'][i%3]}))};
  showPlayingChord(4.5);
  const visible=document.querySelectorAll('#chordStrip .strip-chord').length;
  song.chordAnalysis=previous;
  if(visible<4)throw Error('Chord strip should show several nearby chords');
 });
 check('closely spaced chords stay in consecutive order through the handoff',await page.evaluate(()=>{
  const original=song.chordAnalysis;
  song.chordAnalysis={shift:0,changes:[{time:0,name:'Am'},{time:4,name:'G'},{time:4.4,name:'D'},{time:5.2,name:'C'},{time:6.2,name:'Em'}]};
  const previews=[0.1,2,3.9,4.1,4.5].map(time=>{
   showPlayingChord(time);
   return [...document.querySelectorAll('#chordStrip .strip-chord:not(.past)')]
    .sort((a,b)=>parseFloat(a.style.left)-parseFloat(b.style.left)).map(label=>label.textContent).join(',');
  });
  song.chordAnalysis=original;
  showPlayingChord(audio.currentTime);
  return previews.slice(0,3).every(value=>value.startsWith('G,D,C'))&&previews[3].startsWith('D,C')&&previews[4].startsWith('C,Em');
 }));
 check('an upcoming chord never jumps right when it becomes next',await page.evaluate(()=>{
  const original=song.chordAnalysis;
  song.chordAnalysis={shift:0,changes:[{time:0,name:'Asus4'},{time:4,name:'G'},{time:6,name:'D'},{time:8,name:'C'}]};
  showPlayingChord(3.999);
  const chord=[...document.querySelectorAll('#chordStrip .strip-chord')].find(label=>label.textContent==='D');
  const before=parseFloat(chord.style.left);
  showPlayingChord(4.001);
  const next=document.querySelector('#chordStrip .next');
  const after=parseFloat(next.style.left);
  const smooth=next===chord&&next.textContent==='D'&&after<=before&&before-after<1;
  song.chordAnalysis=original;
  showPlayingChord(audio.currentTime);
  return smooth;
 }));
 check('the strip fits multiple nearby chords',true);
 await page.locator('#audio').evaluate(a=>{a.currentTime=9;});
 await page.waitForFunction(()=>document.querySelector('#clock').textContent.startsWith('0:09'));
 check('an unclear stretch holds the last detected chord',await page.locator('#playingChord').textContent()==='C');
 await page.locator('#readerTools').tap();await page.locator('#chordMatchButton').tap();
 await page.locator('#startChordMatch').tap();
 await page.waitForFunction(()=>document.querySelector('#playingChord').classList.contains('matched-chord'));
 check('the next chord blinks at the current chord size during playback',await page.locator('#chordStrip .next').evaluate(next=>
  getComputedStyle(next).fontSize===getComputedStyle(document.querySelector('#playingChord')).fontSize
  &&getComputedStyle(next).animationName==='next-chord-blink'
 ));
 check('matching guitar audio turns the expected chord green',await page.locator('#playingChord').textContent()==='G');
 await page.locator('#audio').evaluate(a=>{a.pause();a.dispatchEvent(new Event('ended'));});
 await page.waitForFunction(()=>document.querySelector('#chordMatchResult').textContent.includes('50%'));
 check('end-of-song score saves a personal best',await page.locator('#chordMatchBest').textContent()==='Personal best · 50% (1 / 2)');
 await page.locator('#chordMatchDialog [data-close]').tap();
 await page.locator('#readerTools').tap();await page.locator('#chordMatchButton').tap();
 check('the song personal best is available when reopening chord match',await page.locator('#chordMatchBest').textContent()==='Personal best · 50% (1 / 2)');
 check('no JavaScript errors',!errors.length);
 console.log(`${checks.length} auto-follow checks passed.`);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
