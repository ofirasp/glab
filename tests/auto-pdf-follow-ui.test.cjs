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
songs[0].pdfVersion='stable-pdf';songs[0].chordAnalysis={changes:[{time:0,name:'G'},{time:4.23,name:'C'},{time:8,name:'D'},{time:12,name:'G'}]};songs[0].rhythm={bpm:120,meter:'4/4',firstDownbeat:0};
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
  return res.end(JSON.stringify([{number:1,chords:[{name:'G',x:.2,y:.2,width:.03,height:.01},{name:'C',x:.4,y:.55,width:.03,height:.01}]},{number:2,chords:[{name:'D',x:.2,y:.5,width:.03,height:.01},{name:'G',x:.4,y:.8,width:.03,height:.01}]}]));
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
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});try{const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);await page.waitForFunction(()=>typeof selectSong==='function'&&songs.length);await page.evaluate(()=>selectSong(songs[0]));await page.waitForFunction(()=>pageReady);const cues=await page.evaluate(()=>JSON.stringify(song.cues));await page.locator('#toolsButton').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForFunction(()=>!document.querySelector('#enableAutoPdf').disabled);assert.match(await page.locator('#pdfSyncStatus').textContent(),/4 aligned/);assert.equal(await page.locator('#pdfSyncDialog').evaluate(e=>e.getBoundingClientRect().bottom<=480),true);await page.locator('#enableAutoPdf').tap();await page.waitForSelector('.auto-pdf-highlight');for(const factor of [1,1.5,3]){await page.evaluate(value=>{zoom=value;void renderPage(1);},factor);await page.waitForFunction(()=>pageReady&&document.querySelector('.auto-pdf-highlight'));assert.equal(await page.locator('.auto-pdf-highlight').evaluate(e=>Math.abs(e.getBoundingClientRect().height-(document.querySelector('#pdfImage').clientHeight*.01+4))<.3),true,'highlight padding must stay four pixels total at every PDF zoom');}await page.evaluate(()=>{zoom=1.5;void renderPage(1);});await page.waitForFunction(()=>pageReady&&document.querySelector('.auto-pdf-highlight'));assert.equal(await page.locator('#autoPdfToggle').isChecked(),true);if(await page.locator('#autoPdfToggle').isHidden())await page.locator('#readerControlsToggle').tap();await page.locator('#autoPdfToggle').uncheck();assert.equal(await page.locator('#pdfFollowMode').inputValue(),'manual');await page.locator('#autoPdfToggle').check();assert.equal(await page.locator('#pdfFollowMode').inputValue(),'auto');await page.locator('#follow').tap();assert.equal(await page.locator('#autoPdfToggle').isChecked(),true);assert.equal(await page.evaluate(()=>AutoPdfFollow.state().suspended),true);await page.locator('#follow').tap();assert.equal(await page.evaluate(()=>AutoPdfFollow.state().suspended),false);await page.evaluate(()=>{audio.currentTime=4.1;tick();});await page.waitForFunction(()=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey==='1:1');await page.waitForTimeout(1000);assert.equal(await page.locator('.auto-pdf-highlight').evaluate(e=>{const a=e.getBoundingClientRect(),b=document.querySelector('#pdfViewport').getBoundingClientRect();return Math.abs(a.top+a.height/2-b.top-b.height/2)<6;}),true);await page.screenshot({path:'/tmp/glab-auto-pdf-follow.png'});await page.evaluate(()=>{song.rhythm.firstDownbeat=.2;song.updated='after-rhythm-edit';audio.currentTime=4.1;tick();});await page.waitForFunction(()=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey==='1:0');await page.evaluate(()=>{audio.currentTime=8.3;tick();});await page.waitForFunction(()=>page===2&&pageReady);await page.waitForFunction(()=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey==='2:0');await page.locator('#pdfViewport').dispatchEvent('wheel');assert.equal(await page.locator('#autoPdfResume').isVisible(),true);assert.equal(await page.locator('.auto-pdf-highlight').count(),0);await page.locator('#autoPdfResume').tap();await page.waitForSelector('.auto-pdf-highlight');await page.locator('#previous').tap();await page.waitForFunction(()=>page===1&&pageReady);assert.equal(await page.locator('#autoPdfResume').isVisible(),true);await page.locator('#autoPdfResume').tap();await page.waitForFunction(()=>page===2&&pageReady);await page.locator('#chordFocusToggle').tap();await page.locator('#toolsButton').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForFunction(()=>!document.querySelector('#enableAutoPdf').disabled);await page.locator('#pdfSyncNow').tap();await page.locator('#pdfSyncCorrect').tap();assert.equal(await page.locator('#pdfSyncImage').isVisible(),true);assert.equal(await page.locator('#pdfSyncTargets .pdf-sync-hit').first().evaluate(e=>Math.abs(e.getBoundingClientRect().height-(document.querySelector('#pdfSyncImage').clientHeight*.01+4))<.3),true,'sync editor hitbox stays on the chord text row');await page.waitForSelector('#pdfSyncTargets [data-key="2:0"]');await page.locator('#pdfSyncTargets [data-key="2:0"]').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncDialog').open);assert.match(await page.locator('#pdfSyncConfidence').textContent(),/Saved match/);await page.locator('#pdfSyncResetSection').tap();assert.equal(await page.locator('#pdfSyncResetSection').isDisabled(),true);await page.locator('#pdfSyncCorrect').tap();await page.locator('#pdfSyncTargets [data-key="2:0"]').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncDialog').open);await page.locator('#pdfSyncResetAll').tap();assert.equal(await page.locator('#pdfFollowMode').inputValue(),'manual');assert.equal(await page.evaluate(()=>JSON.stringify(song.cues)),cues);assert.equal(await page.locator('#pdfSyncResetAll').isDisabled(),true);await page.locator('#enableAutoPdf').tap();assert.equal(await page.evaluate(()=>JSON.stringify(song.cues)),cues);await page.reload();await page.waitForFunction(()=>pageReady);await page.waitForFunction(()=>document.querySelector('#pdfFollowMode').value==='auto'&&!document.querySelector('#pdfFollowMode').disabled);await page.locator('#toolsButton').tap();await page.locator('#toolsTabPlayback').tap();await page.locator('#pdfFollowMode').selectOption('manual');assert.equal(await page.locator('.auto-pdf-highlight').count(),0);assert.equal(await page.evaluate(()=>following),true);await page.evaluate(()=>{song.chordAnalysis.changes[0].name='G5';localStorage.setItem('guitar-chords-'+song.id,JSON.stringify({tuning:'standard',alternates:{G:'G5'}}));GuitarChordViewer.reset(song.id);GuitarChordViewer.showPage({id:song.id,version:song.updated,page});update();});await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForFunction(()=>!document.querySelector('#enableAutoPdf').disabled);assert.match(await page.locator('#pdfSyncStatus').textContent(),/4 aligned/);await page.locator('#pdfSyncClose').tap();await page.locator('[data-close="toolsDialog"]').tap();await page.evaluate(()=>{songs[1].chordAnalysis=structuredClone(songs[0].chordAnalysis);songs[1].chordAnalysis.changes[0].name='G';selectSong(songs[1]);});await page.waitForFunction(()=>pageReady&&!document.querySelector('#autoPdfToggle').disabled);if(await page.locator('#autoPdfToggle').isHidden())await page.locator('#readerControlsToggle').tap();await page.locator('#autoPdfToggle').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncDialog').open&&!document.querySelector('#pdfSyncClose').disabled);await page.locator('#pdfSyncClose').tap();assert.equal(await page.locator('#autoPdfToggle').isChecked(),true);assert.equal(await page.evaluate(()=>AutoPdfFollow.state().enabled),true);await page.locator('[data-close="toolsDialog"]').tap();await page.locator('#autoPdfToggle').uncheck();await page.locator('#autoPdfToggle').check();assert.equal(await page.locator('#pdfSyncDialog').evaluate(e=>e.open),false);assert.equal(await page.locator('#autoPdfToggle').isChecked(),true);await page.evaluate(()=>{songs[2].chordAnalysis={changes:[{time:0,name:'G'}]};selectSong(songs[2]);});await page.waitForFunction(()=>pageReady&&!document.querySelector('#autoPdfToggle').disabled);if(await page.locator('#autoPdfToggle').isHidden())await page.locator('#readerControlsToggle').tap();await page.locator('#autoPdfToggle').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncDialog').open&&!document.querySelector('#pdfSyncClose').disabled);await page.waitForSelector('#pdfSyncTargets .selected');const suggested=await page.locator('#pdfSyncTargets .selected').getAttribute('data-key');await page.locator('#pdfSyncClose').tap();await page.locator('[data-close="toolsDialog"]').tap();assert.equal(await page.locator('#autoPdfToggle').isChecked(),true);await page.evaluate(()=>{audio.currentTime=1;tick();});await page.waitForSelector('.auto-pdf-highlight');assert.equal(await page.locator('.auto-pdf-highlight').getAttribute('data-pdf-chord-key'),suggested);assert.deepEqual(errors,[]);console.log('PASS PDF sync, highlight and centering, rhythm edits, page changes, manual navigation/resume, tapped correction, unchanged cues, saved mode and Manual Follow');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});