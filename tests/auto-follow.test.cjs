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
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 const checks=[];const check=(name,condition)=>{assert.ok(condition,name);checks.push(name);console.log('PASS',name);};
 try{
 browser=await chromium.launch({headless:true,...(process.env.GPL_TEST_CHROME?{executablePath:process.env.GPL_TEST_CHROME}:{})});
 const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('guitar-clean-song-layout','false');
  window.testScreenLocks=0;
  Object.defineProperty(navigator,'wakeLock',{value:{async request(){
   window.testScreenLocks++;
   const sentinel=new EventTarget();
   sentinel.release=async()=>{window.testScreenLocks--;sentinel.dispatchEvent(new Event('release'));};
   return sentinel;
  }}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);
 const openSong=async title=>{if(!await page.locator('#libraryDialog').isVisible())await page.locator('#libraryButton').tap();await page.locator('.songrow').filter({hasText:title}).getByRole('button',{name:'Open',exact:true}).tap();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);await page.waitForFunction(()=>!document.querySelector('#audio').paused);};
 const isOn=()=>page.locator('#follow').getAttribute('aria-pressed').then(v=>v==='true');
 await page.evaluate(()=>{
  window.countInDigits=[];
  window.countInTones=[];
  const createOscillator=AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator=function(){
   const oscillator=createOscillator.call(this),start=oscillator.start.bind(oscillator);
   oscillator.start=time=>{window.countInTones.push({time,frequency:oscillator.frequency.value});start(time);};
   return oscillator;
  };
  new MutationObserver(()=>{
   const digit=document.querySelector('#songCountInNumber').textContent;
   if(window.countInDigits.at(-1)!==digit)window.countInDigits.push(digit);
  }).observe(document.querySelector('#songCountInNumber'),{childList:true,subtree:true,characterData:true});
 });
 await openSong('With cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('song autoplay counts down five to one before starting',await page.evaluate(()=>window.countInDigits.join(',')==='5,4,3,2,1'));
 check('count-in schedules soft pitched beeps at the default beat interval',await page.evaluate(()=>{
  const tones=window.countInTones;
  return tones.length>=4&&tones.every(tone=>tone.frequency>700)
   &&tones.slice(1).every((tone,index)=>Math.abs(tone.time-tones[index].time-1)<.03);
 }));

 await page.locator('#audio').evaluate(a=>a.pause());
 await page.locator('#play').tap();
 await page.locator('#songCountIn').waitFor();
 check('song stays paused while the countdown is displayed',await page.locator('#audio').evaluate(a=>a.paused));
 check('count-in uses a compact centered popup',await page.locator('#songCountIn').evaluate(dialog=>{
  const r=dialog.getBoundingClientRect();
  return r.width<=300&&r.height<=320&&Math.abs(r.x+r.width/2-innerWidth/2)<2&&Math.abs(r.y+r.height/2-innerHeight/2)<2;
 }));

 await page.locator('#cancelSongCountIn').tap();
 check('Cancel closes the countdown and keeps playback paused',await page.locator('#songCountIn').isHidden()&&await page.locator('#audio').evaluate(a=>a.paused));
 await page.locator('#toolsButton').tap();await page.locator('#toolsTabPlayback').tap();
 await page.locator('#songCountInEnabled').uncheck();
 const beepsBeforeDisabledPlay=await page.evaluate(()=>window.countInTones.length);
 await page.locator('#toolsDialog [data-close]').tap();
 await page.locator('#play').tap();
 await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('count-in can be switched off from Song tools Playback',await page.locator('#songCountIn').isHidden()&&await page.evaluate(()=>window.countInTones.length)===beepsBeforeDisabledPlay);
 await page.locator('#audio').evaluate(a=>a.pause());
 await page.locator('#toolsButton').tap();await page.locator('#toolsTabPlayback').tap();
 await page.locator('#songCountInEnabled').check();
 await page.locator('#toolsDialog [data-close]').tap();

 await page.locator('#play').tap();
 await page.waitForFunction(()=>!document.querySelector('#audio').paused);

 check('song title sits between Tools and FullScreen',await page.locator('#songTitle').evaluate(title=>
  title.previousElementSibling.id==='toolsButton'&&title.compareDocumentPosition(document.querySelector('#readerToggle'))&Node.DOCUMENT_POSITION_FOLLOWING));
 check('track switch is at least 44 pixels tall',await page.locator('#trackToggle').evaluate(button=>button.getBoundingClientRect().height>=44));
 await page.locator('#audio').evaluate(a=>{a.currentTime=3;});
 await page.getByRole('button',{name:'Go to start'}).tap();
 await page.locator('#songCountIn').waitFor();
 check('restart pauses at the beginning before the count-in finishes',await page.locator('#audio').evaluate(a=>a.paused&&a.currentTime<.1));
 await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('the progress button returns playback to the start',await page.locator('#audio').evaluate(a=>a.currentTime<.4&&!a.paused));
 check('autoplay enables Follow for a song with cues',await isOn());
 await page.waitForFunction(()=>window.testScreenLocks===1);
 check('song playback holds a screen wake lock',await page.evaluate(()=>window.testScreenLocks===1));
 const simple=page.getByRole('switch',{name:'Simple',exact:true});
 const simplePage=page.waitForResponse(r=>r.url().includes('/page/1?')&&r.url().includes('variant=simple'));
 await simple.tap();await simplePage;
 check('Simple shares the Bar sync row',await page.locator('#simpleVersionControl').evaluate(label=>label.parentElement.contains(document.querySelector('#stageSyncBar'))));
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
 const beforeRestart=await page.locator('#audio').evaluate(a=>a.currentTime);
 await page.locator('#stageStart').tap();
 await page.locator('#songCountIn').waitFor();
 check('fullscreen restart also shows the count-in',await page.locator('#audio').evaluate(a=>a.paused&&a.currentTime<.1));
 await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('fullscreen restart button returns the playing song to the start',await page.locator('#audio').evaluate(a=>a.currentTime<.5&&!a.paused));
 await page.locator('#audio').evaluate((a,time)=>{a.currentTime=time;},beforeRestart);
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
 await page.locator('#readerTools').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#rhythmButton').tap();await page.locator('#analyzeRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Time signature unclear'));
 await page.locator('#doubleRhythmTempo').tap();
 check('double tempo corrects a half-time estimate',await page.locator('#rhythmBpm').inputValue()==='192');
 await page.locator('#halfRhythmTempo').tap();
 check('rhythm dialog keeps Save visible without scrolling',await page.locator('#rhythmDialog').evaluate(dialog=>{
  const body=dialog.querySelector('.dialogbody'),save=document.querySelector('#saveRhythm').getBoundingClientRect();
  return body.scrollHeight<=body.clientHeight+1&&save.bottom<=innerHeight&&save.top>=dialog.getBoundingClientRect().top;
 }));
 check('uncertain meter leaves the selector blank',await page.locator('#rhythmBpm').inputValue()==='96'&&await page.locator('#rhythmMeter').inputValue()==='');
 await page.locator('#rhythmBpm').tap();
 await page.locator('#gplTouchKeyboard').waitFor();
 await page.locator('#gplTouchKeyboard').getByRole('button',{name:'Select all',exact:true}).tap();
 for(const digit of ['1','2','0','.','5'])await page.locator('#gplTouchKeyboard').getByRole('button',{name:digit,exact:true}).tap();
 await page.locator('#gplTouchKeyboard').getByRole('button',{name:'Done',exact:true}).tap();
 check('tempo opens a decimal keypad and retains numeric validation',await page.locator('#rhythmBpm').evaluate(field=>field.type==='number'&&field.valueAsNumber===120.5&&field.checkValidity()));
 await page.waitForTimeout(250);
 await page.locator('#rhythmBpm').evaluate(field=>{field.blur();field.focus();});
 await page.waitForTimeout(120);
 check('restoring focus does not reopen the keypad',await page.locator('#gplTouchKeyboard').isHidden());
 await page.locator('#rhythmMeter').selectOption('6/8');
 await page.locator('#saveRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Rhythm saved'));
 check('saving directly after keypad entry persists tempo without reopening',songs[0].rhythm.bpm===120.5&&await page.locator('#gplTouchKeyboard').isHidden());
 await page.locator('#rhythmTapUnit').selectOption('bar');
 await page.locator('#rhythmMeter').selectOption('4/4');
 check('two beat-one taps a bar apart calculate tempo without restarting',await page.evaluate(()=>{
  const original=performance.now;
  let now=1000;performance.now=()=>now;
  try{
   document.querySelector('#tapRhythmTempo').click();
   now+=2400;document.querySelector('#tapRhythmTempo').click();
   return document.querySelector('#rhythmBpm').value==='100'
    &&document.querySelector('#tapRhythmTempo').textContent.includes('Tap 2');
  }finally{performance.now=original;}
 }));
 await page.locator('#rhythmTapUnit').selectOption('beat');
 check('tap tempo updates after two taps and restarts visibly after a pause',await page.evaluate(()=>{
  const original=performance.now;
  let now=2000;
  performance.now=()=>now;
  try {
   document.querySelector('#tapRhythmTempo').click();
   const first=document.querySelector('#tapRhythmTempo').textContent.includes('Tap 1');
   now+=600;document.querySelector('#tapRhythmTempo').click();
   const second=document.querySelector('#rhythmBpm').value==='100';
   now+=2300;document.querySelector('#tapRhythmTempo').click();
   const restarted=document.querySelector('#tapRhythmTempo').textContent.includes('Tap 1');
   now+=500;document.querySelector('#tapRhythmTempo').click();
   return first&&second&&restarted&&document.querySelector('#rhythmBpm').value==='120';
  }finally{performance.now=original;}
 }));
 check('tapping four half-second beats estimates 120 BPM',await page.evaluate(()=>{
  const original=performance.now;
  let now=10000;
  performance.now=()=>now;
  try {
   for(let index=0;index<4;index++){document.querySelector('#tapRhythmTempo').click();now+=500;}
   return document.querySelector('#rhythmBpm').value==='120';
  }finally{performance.now=original;}
 }));
 check('tempo stays constant through 30 taps with varying release delays',await page.evaluate(()=>{
  const original=performance.now;let now=20000;performance.now=()=>now;
  const button=document.querySelector('#tapRhythmTempo');
  try {
   const estimates=[];
   for(let index=0;index<30;index++){
    now=20000+index*500;
    button.dispatchEvent(new PointerEvent('pointerdown',{isPrimary:true,button:0}));
    now+=index%2?240:40;
    button.click();
    if(index>0)estimates.push(Number(document.querySelector('#rhythmBpm').value));
   }
   return estimates.every(bpm=>bpm===120)&&button.textContent.includes('Tap 30');
  }finally{performance.now=original;}
 }));
 await page.locator('#rhythmBpm').fill('96');
 await page.locator('#rhythmMeter').selectOption('6/8');await page.locator('#previewRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Playing two bars over the song'));
 check('click preview keeps the song playing',await page.locator('#audio').evaluate(a=>!a.paused));
 await page.locator('#previewRhythm').tap();
 check('stopping the clicks leaves the song playing',await page.locator('#previewRhythm').textContent()==='Preview clicks'&&await page.locator('#audio').evaluate(a=>!a.paused));
 await page.locator('#saveRhythm').tap();
 await page.waitForFunction(()=>document.querySelector('#rhythmStatus').textContent.includes('Rhythm saved'));
 check('edited rhythm is saved with the current audio version',songs[0].rhythm.bpm===96&&songs[0].rhythm.meter==='6/8');
 await page.locator('#rhythmDialog [data-close]').tap();
 await page.locator('#toolsDialog [data-close]').tap();
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
 await page.waitForFunction(()=>!document.querySelector('#audio').paused);
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
 await page.locator('#readerTools').tap();await page.locator('#toolsTabPractice').tap();await page.locator('#recordReviewButton').tap();
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
 await page.locator('#toolsDialog [data-close]').tap();
 await page.locator('#readerTools').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#analyzeChordsButton').tap();
 await page.locator('#chordAnalysisShift').selectOption('2');await page.locator('#runChordAnalysis').tap();
 await page.waitForFunction(()=>document.querySelector('#chordAnalysisStatus').textContent.includes('Saved 2'));
 await page.locator('#analyzeChordsDialog [data-close]').tap();
 await page.locator('#toolsDialog').waitFor();
 check('closing Analyze chords returns to Song tools',await page.locator('#toolsDialog').isVisible());
 await page.locator('#toolsDialog [data-close]').tap();
 await page.locator('#audio').evaluate(a=>{a.currentTime=1;});
 await page.waitForFunction(()=>document.querySelector('#playingChord').textContent==='G');
 await simple.tap();
 check('simple uses the existing timeline until analyzed',await page.evaluate(()=>activeChordAnalysis()===song.chordAnalysis));
 await page.evaluate(()=>document.querySelector('#analyzeChordsButton').click());
 await page.locator('#runChordAnalysis').tap();
 await page.waitForFunction(()=>document.querySelector('#chordAnalysisStatus').textContent.includes('Saved 2'));
 check('simple analysis uses its PDF and enables matching',await page.evaluate(()=>activeChordAnalysis().changes[0].name==='Am'&&song.chordAnalysis.changes[0].name==='G'&&!document.querySelector('#chordMatchButton').disabled));
 await page.locator('#analyzeChordsDialog [data-close]').tap();
 await page.locator('#toolsDialog [data-close]').tap();
 await simple.tap();
 check('regular analysis is preserved after analyzing simple',await page.evaluate(()=>activeChordAnalysis().changes[0].name==='G'));
 await page.locator('#readerControlsToggle').tap();
 check('fullscreen PDF view keeps bars and hides the large chord cards',await page.locator('#fullscreenChords').isHidden()&&await page.locator('#stageBeats').isVisible()
  &&await page.locator('#songTitle').isVisible()&&await page.locator('#pageNumber').isHidden());
 check('fullscreen includes a chord diagram and next-change countdown',await page.locator('#stageDiagram svg').count()===1&&await page.locator('#stageNext').textContent()==='C'
  &&await page.locator('#stageSeconds').textContent().then(text=>text.includes('s')));
 await page.locator('#chordFocusToggle').tap();
 check('Chord Focus puts playback and Controls on the same bottom row',await page.evaluate(()=>{
  const ids=['stagePlay','stageSeek','readerControlsToggle'];
  const centers=ids.map(id=>{const rect=document.getElementById(id).getBoundingClientRect();return rect.y+rect.height/2;});
  return Math.max(...centers)-Math.min(...centers)<2;
 }));
 check('Chord Focus shows the large chord cards and hides the PDF',await page.locator('#fullscreenChords').isVisible()&&await page.locator('#pdfViewport').isHidden()&&await page.locator('#stageDiagram').evaluate(el=>el.getBoundingClientRect().height>150));
 check('beat strip groups two bars and updates completed and current beats',await page.evaluate(()=>{
  const saved=song.rhythm;
  song.rhythm={bpm:120,meter:'4/4',firstDownbeat:0};
  showChordBeats(2.6,0,4,'D');
  const svg=document.querySelector('#stageBeatGraphic svg');
  const okay=svg.querySelectorAll('circle').length===8
    &&svg.querySelectorAll('[data-state="done"]').length===5
    &&svg.querySelectorAll('[data-state="current"]').length===1
    &&svg.textContent.includes('Bar 1')&&svg.textContent.includes('Bar 2');
  showChordBeats(.4,0,1,'D');
  const half=document.querySelectorAll('#stageBeatGraphic circle[data-in-chord="true"]').length===2;
  song.rhythm=saved;
  showPlayingChord(audio.currentTime);
  return okay&&half;
 }));
 check('6/8 displays six pulses with accents on one and four',await page.evaluate(()=>{
  const saved=song.rhythm;
  song.rhythm={bpm:60,meter:'6/8',firstDownbeat:0};
  showChordBeats(.8,0,2,'D');
  const dots=[...document.querySelectorAll('#stageBeatGraphic circle')];
  const okay=dots.length===12
   &&dots.filter(dot=>dot.dataset.accent==='true').map(dot=>dot.dataset.pulse).join(',')==='1,4,1,4'
   &&dots.find(dot=>dot.dataset.state==='current')?.dataset.pulse==='3';
  showChordBeats(1.2,1,2,'G');
  const fixedBefore=dots.find(dot=>dot.dataset.pulse==='4').getAttribute('cx');
  const continuing=document.querySelector('#stageBeatGraphic circle[data-state="current"]')?.dataset.pulse==='4'
    &&document.querySelector('#stageBeatGraphic circle[data-state="current"]').getAttribute('cx')===fixedBefore;
  song.rhythm={bpm:60,meter:'6/8',firstDownbeat:null};
  showChordBeats(1.2,1,2,'G');
  const fallback=document.querySelector('#stageBeatGraphic circle[data-state="current"]')?.dataset.pulse==='4';
  song.rhythm=saved;showPlayingChord(audio.currentTime);
  return okay&&continuing&&fallback;
 }));
 await page.evaluate(()=>{
  song.rhythm={bpm:120,meter:'4/4',firstDownbeat:null};
  showPlayingChord(audio.currentTime);
 });
 if(await page.locator('#stageSyncBar').isHidden())await page.locator('#readerControlsToggle').tap();
 await page.locator('#stageSyncBar').tap();
 await page.waitForFunction(()=>document.querySelector('#stageSyncBar').textContent.includes('Bar synced'));
 check('bar alignment saves at the current song position',await page.evaluate(()=>Number.isFinite(song.rhythm.firstDownbeat)&&Math.abs(song.rhythm.firstDownbeat-audio.currentTime)<.5));
 check('two chords in one bar render as two half-bar segments',await page.evaluate(()=>{
  const saved=song.rhythm,analysis=song.chordAnalysis;
  song.rhythm={bpm:120,meter:'4/4',firstDownbeat:0};
  song.chordAnalysis={shift:0,changes:[{time:0,name:'G'},{time:1,name:'D'},{time:2,name:'C'}]};
  showChordBeats(.4,0,1,'D');
  const parts=[...document.querySelectorAll('#stageBeatGraphic [data-chord-segment]')];
  const before=parts.slice(0,2).map(part=>[part.dataset.chordSegment,Number(part.dataset.barFraction),part.getAttribute('x')]);
  showChordBeats(1.2,1,2,'C');
  const after=[...document.querySelectorAll('#stageBeatGraphic [data-chord-segment]')].slice(0,2);
  const okay=before[0][0]==='G'&&before[1][0]==='D'&&before.every(part=>part[1]===.5)
    &&after.every((part,index)=>part.getAttribute('x')===before[index][2]);
  song.rhythm=saved;song.chordAnalysis=analysis;showPlayingChord(audio.currentTime);
  return okay;
 }));
 check('small chord timing errors do not create fragments across a bar line',await page.evaluate(()=>{
  const saved=song.rhythm,analysis=song.chordAnalysis;
  song.rhythm={bpm:120,meter:'4/4',firstDownbeat:0};
  song.chordAnalysis={shift:0,changes:[{time:0,name:'Am7'},{time:1.96,name:'C'},{time:3.5,name:'D7'}]};
  showChordBeats(3.7,3.5,4,'G');
  const parts=[...document.querySelectorAll('#stageBeatGraphic [data-chord-segment]')];
  const okay=parts.map(part=>part.dataset.chordSegment).join(',')==='Am7,C,D7'
    &&parts.map(part=>Number(part.dataset.barFraction)).join(',')==='1,0.75,0.25';
  song.rhythm=saved;song.chordAnalysis=analysis;showPlayingChord(audio.currentTime);
  return okay;
 }));
 check('a late chord boundary cannot leave a highlighted sliver in the next bar',await page.evaluate(()=>{
  const saved=song.rhythm,analysis=song.chordAnalysis;
  song.rhythm={bpm:120,meter:'4/4',firstDownbeat:0};
  song.chordAnalysis={shift:0,changes:[{time:0,name:'C'},{time:2.13,name:'Bm'},{time:3.5,name:'Am7'}]};
  showChordBeats(1.8,0,2.13,'Bm');
  const parts=[...document.querySelectorAll('#stageBeatGraphic [data-chord-segment]')];
  const okay=parts.map(part=>part.dataset.chordSegment).join(',')==='C,Bm,Am7'
   &&parts.map(part=>Number(part.dataset.barFraction)).join(',')==='1,0.75,0.25'
   &&parts.filter(part=>part.getAttribute('fill')==='#375743').length===1;
  song.rhythm=saved;song.chordAnalysis=analysis;showPlayingChord(audio.currentTime);
  return okay;
 }));
 check('missing rhythm offers setup instead of guessing beats',await page.evaluate(()=>{
  const saved=song.rhythm;
  song.rhythm=null;
  showChordBeats(1,0,4,'D');
  const okay=!document.querySelector('#stageBeatGraphic svg')&&document.querySelector('#stageBeatCaption').textContent.includes('Set tempo');
  song.rhythm=saved;showPlayingChord(audio.currentTime);
  return okay;
 }));
 await page.screenshot({path:'/tmp/glab-chord-focus.png'});
 await page.locator('#chordFocusToggle').tap();
 check('fullscreen PDF playback shares the Controls row',await page.evaluate(()=>{
  const play=document.querySelector('#stagePlay').getBoundingClientRect(),toggle=document.querySelector('#readerControlsToggle').getBoundingClientRect();
  return Math.abs(play.y+play.height/2-toggle.y-toggle.height/2)<2;
 }));
 check('PDF View restores the sheet and hides the large cards',await page.locator('#pdfViewport').isVisible()&&await page.locator('#fullscreenChords').isHidden()&&await page.locator('#stageBeats').isVisible());
 await page.screenshot({path:'/tmp/glab-pdf-chords.png'});
 await page.locator('#readerToggle').tap();
 check('Split view retains the bars without the large chord cards',await page.locator('#stageBeats').isVisible()&&await page.locator('#fullscreenChords').isHidden());
 check('Split view uses the upper row for bars and hides the running chords',await page.locator('#stageBeats').evaluate(bars=>bars.parentElement.id==='readerPageControls')&&await page.locator('#chordStrip').isHidden());
 await page.screenshot({path:'/tmp/glab-bars-header.png'});
 check('zoom controls sit beside Follow without the Scroll label',await page.locator('#zoomOut').evaluate(button=>button.parentElement.classList.contains('cuebar'))
  &&await page.locator('#pageNumber').textContent().then(text=>!text.includes('Scroll')));
 check('chord labels above bars use the larger text size',await page.locator('#stageBeatGraphic svg text[font-weight="750"]').first().getAttribute('font-size')==='15');
 await page.locator('#audio').evaluate(a=>{a.currentTime=9;});
 await page.waitForFunction(()=>document.querySelector('#clock').textContent.startsWith('0:09'));
 check('an unclear stretch holds the last detected chord',await page.locator('#playingChord').textContent()==='C');
 await page.locator('#readerToggle').tap();
 await page.locator('#toolsButton').tap();await page.locator('#toolsTabPractice').tap();await page.locator('#chordMatchButton').tap();
 await page.locator('#startChordMatch').tap();
 await page.waitForFunction(()=>document.querySelector('#playingChord').classList.contains('matched-chord'));
 check('fullscreen gives green feedback and a running score for a match',await page.locator('#stageCurrentCard').evaluate(el=>el.classList.contains('matched'))
  &&await page.locator('#stageScore').textContent()==='Matched 1 / 2');
 check('one confident match later in the section turns the expected chord green',await page.locator('#playingChord').textContent()==='G');
 await page.locator('#audio').evaluate(a=>{a.pause();a.dispatchEvent(new Event('ended'));});
 await page.waitForFunction(()=>document.querySelector('#chordMatchResult').textContent.includes('50%'));
 check('end-of-song score saves a personal best',await page.locator('#chordMatchBest').textContent()==='Personal best · 50% (1 / 2)');
 await page.locator('#chordMatchDialog [data-close]').tap();
 await page.locator('#toolsDialog [data-close]').tap();
 await page.locator('#toolsButton').tap();await page.locator('#toolsTabPractice').tap();await page.locator('#chordMatchButton').tap();
 check('the song personal best is available when reopening chord match',await page.locator('#chordMatchBest').textContent()==='Personal best · 50% (1 / 2)');
 check('the latest completed score is also available',await page.locator('#chordMatchLast').textContent()==='Last score · 50% (1 / 2)');
 await page.locator('#chordMatchDialog [data-close]').tap();
 await page.locator('#toolsDialog [data-close]').tap();
 if(await page.locator('#chordListButton').isHidden())await page.locator('#readerControlsToggle').tap();
 await page.locator('#chordListButton').tap();
 const originalPdf=await page.locator('#pdfImage').getAttribute('src');
 await page.locator('#songChordList [data-original-chord="G"]').tap();
 await page.locator('#chordTuning').selectOption('standard');
 check('song chords retains the original shape view',await page.locator('#chordDiagram svg').count()===1);
 await page.locator('#chooseAlternateChord').tap();
 await page.locator('#alternateRoot').selectOption('A');
 await page.locator('#alternateType').selectOption('m');
 check('alternate picker previews its shape before applying',await page.locator('#alternatePreview svg').count()===1);
 await page.locator('#alternateChordDialog [data-close]').tap();
 check('cancelling alternate picker keeps the current chord',await page.evaluate(()=>playbackChord('G')==='G'));
 await page.locator('#chooseAlternateChord').tap();
 await page.locator('#alternateRoot').selectOption('A');
 await page.locator('#alternateType').selectOption('m');
 await page.locator('#applyAlternateChord').tap();
 await page.locator('#chordDialog [data-close]').tap();
 await page.locator('#chordsDialog [data-close]').tap();
 await page.locator('#audio').evaluate(a=>{a.currentTime=1;});
 await page.waitForFunction(()=>document.querySelector('#playingChord').textContent==='Am');
 check('alternate chord updates playback and bars without replacing the PDF',await page.locator('#stageCurrent').textContent()==='Am'
  &&await page.locator('#stageBeatGraphic [data-chord-segment="Am"]').count()>0&&await page.locator('#pdfImage').getAttribute('src')===originalPdf);
 await page.locator('#chordListButton').tap();
 await page.locator('#songChordList [data-original-chord="G"]').tap();
 check('alternate chord shape is available from the song chord list',await page.locator('#chordName').textContent()==='G → Am');
 await page.locator('#chordDialog [data-close]').tap();
 await page.locator('#chordsDialog [data-close]').tap();
 expectedChordNames=['Am','C'];streamChord='Am';
 await page.locator('#toolsButton').tap();await page.locator('#toolsTabPractice').tap();await page.locator('#chordMatchButton').tap();
 check('alternate chord configuration has its own best score',await page.locator('#chordMatchBest').textContent()==='No personal best yet.');
 await page.locator('#startChordMatch').tap();
 await page.waitForFunction(()=>document.querySelector('#stageBeatGraphic [data-matched="true"]'));
 check('playing the alternate chord marks its bar section with a check',await page.locator('#stageBeatGraphic [data-match-check="0"]').textContent()==='✓'
  &&await page.locator('#stageCurrentCard').evaluate(card=>card.classList.contains('matched')));
 await page.reload();
 await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);
 check('alternate chord survives reopening the song',await page.evaluate(()=>playbackChord('G')==='Am'));
 check('an unrelated chord has its original name',await page.evaluate(()=>playbackChord('C')==='C'));
 if(await page.locator('#chordListButton').isHidden())await page.locator('#readerControlsToggle').tap();
 await page.locator('#chordListButton').tap();
 await page.locator('#songChordList [data-original-chord="G"]').tap();
 await page.locator('#restoreOriginalChord').tap();
 check('Original removes the alternate selection',await page.evaluate(()=>playbackChord('G')==='G'));
 check('no JavaScript errors',!errors.length);
 console.log(`${checks.length} auto-follow checks passed.`);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
