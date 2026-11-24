// Run with Playwright available via NODE_PATH and GPL_TEST_CHROME set if needed.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="500" height="2000"><rect width="500" height="2000" fill="white"/><g font-family="sans-serif" fill="#203650"><text x="40" y="60" font-size="24">Practice chord sheet</text><text x="100" y="420" font-size="20">G</text><text x="200" y="1120" font-size="20">C</text><text x="100" y="1020" font-size="20">D</text><text x="200" y="1620" font-size="20">G</text><text x="40" y="1170" font-size="16">Let the chord ring, then change with the beat.</text></g></svg>';
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
songs[0].pages=1;songs[0].chordAnalysis={changes:[{time:0,name:'C'},{time:8,name:'Am'},{time:9,name:'F'},{time:12,name:null}]};songs[0].rhythm={bpm:60,meter:'4/4',firstDownbeat:0};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.endsWith('/chord-timeline')&&req.method==='PUT'){
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const data=JSON.parse(body);assert.deepEqual(data.previous,songs[0].chordAnalysis);songs[0].chordAnalysis=data.analysis;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data.analysis));});return;
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
  return res.end(JSON.stringify([{number:1,chords:[{name:'C',x:.2,y:.2,width:.04,height:.01},{name:'C',x:.5,y:.3,width:.04,height:.01},{name:'F',x:.3,y:.6,width:.03,height:.01}]}]));
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
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});try{const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);await page.waitForFunction(()=>typeof selectSong==='function'&&songs.length);await page.evaluate(()=>selectSong(songs[0]));await page.waitForFunction(()=>pageReady);const original=await page.evaluate(()=>JSON.stringify({cues:song.cues,analysis:song.chordAnalysis}));async function editor(){await page.locator('#toolsButton').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForSelector('#pdfSyncTargets .pdf-sync-hit');}await page.evaluate(()=>{window.alignmentSizes=[];const align=PdfChordAlignment.align;PdfChordAlignment.align=(changes,...args)=>{alignmentSizes.push(changes.length);return align(changes,...args);};});await editor();await page.locator('#pdfSyncTargets [data-key="1:0"]').tap();await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncOrdinal').textContent.includes('0:04'));await page.locator('#enableAutoPdf').tap();await page.evaluate(()=>{audio.currentTime=5;tick();});await page.waitForFunction(()=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey==='1:0');await page.evaluate(()=>{document.querySelector('.auto-pdf-highlight')?.classList.remove('auto-pdf-highlight');tick();});await page.waitForFunction(()=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey==='1:0');await editor();assert.match(await page.locator('#pdfSyncOrdinal').textContent(),/2 \/ 5.*next bar/);await page.evaluate(()=>{window.previewChecks=[];window.Audio=class extends EventTarget{constructor(){super();this.playbackRate=1;}load(){if(!this.removed)this.dispatchEvent(new Event('loadedmetadata'));}play(){window.previewChecks.push(this);return Promise.resolve();}pause(){}removeAttribute(){this.removed=true;}};});await page.locator('#pdfSyncHear').tap();assert.equal(await page.evaluate(()=>previewChecks[0].currentTime),4);await page.evaluate(()=>{previewChecks[0].currentTime=8;previewChecks[0].dispatchEvent(new Event('timeupdate'));});assert.equal(await page.locator('#pdfSyncHear').textContent(),'♪ Hear bar');await page.waitForSelector('#pdfSyncTargets [data-key="1:0"]');assert.equal(await page.locator('#pdfSyncRepeat, #pdfSyncReuse').count(),0);await page.locator('#pdfSyncTargets [data-key="1:0"]').tap();assert.equal(await page.locator('#pdfSyncTargets .saved').getAttribute('data-key'),'1:0');await page.locator('#pdfSyncTargets [data-key="1:1"]').tap();await page.locator('#pdfSyncUndo').tap();await page.waitForSelector('#pdfSyncTargets [data-key="1:0"].saved');await page.locator('#pdfSyncTargets [data-key="1:1"]').tap();await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncSection').textContent==='Am');await page.locator('#pdfSyncSkip').tap();assert.match(await page.locator('#pdfSyncConfidence').textContent(),/Skipped/);assert.equal(await page.locator('#pdfSyncSkip').textContent(),'Restore');assert.match(await page.locator('#pdfSyncStatus').textContent(),/1 skipped/);assert.equal(await page.locator('.pdf-sync-editor-panel').evaluate(e=>e.scrollHeight<=e.clientHeight),true);assert.equal(await page.locator('#pdfSyncViewport').evaluate(e=>{const a=e.getBoundingClientRect(),b=document.querySelector('#pdfSyncDialog').getBoundingClientRect(),side=document.querySelector('.pdf-sync-editor-panel').getBoundingClientRect();return a.width>350&&a.height>200&&a.left>=side.right&&a.bottom<=b.bottom-40;}),true);await page.screenshot({path:'/tmp/glab-pdf-skip-repeat.png'});await page.locator('#pdfSyncNext').tap();await page.waitForSelector('#pdfSyncTargets [data-key="1:2"]');await page.locator('#pdfSyncTargets [data-key="1:2"]').tap();await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncOrdinal').textContent.includes('0:12'));await page.locator('#pdfSyncUndo').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncOrdinal').textContent.includes('0:09'));await page.locator('#enableAutoPdf').tap();async function at(time,key){await page.evaluate(t=>{audio.currentTime=t;tick();},time);await page.waitForFunction(k=>document.querySelector('.auto-pdf-highlight')?.dataset.pdfChordKey===k,key);}await at(1,'1:0');await at(5,'1:1');await at(8.25,'1:1');await at(9.25,'1:2');assert.ok(await page.evaluate(()=>alignmentSizes.length>4&&alignmentSizes.every(n=>n===4)),'PDF bar repeats must never enter the global sequence matcher');await page.reload();await page.waitForFunction(()=>pageReady&&!document.querySelector('#pdfFollowMode').disabled);await at(5,'1:1');await editor();await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncSection').textContent==='Am');assert.equal(await page.locator('#pdfSyncSkip').textContent(),'Restore');await page.locator('#pdfSyncSkip').tap();assert.equal(await page.locator('#pdfSyncSkip').textContent(),'Skip detection');await page.locator('#pdfSyncUndo').tap();assert.equal(await page.locator('#pdfSyncSkip').textContent(),'Restore');await page.locator('#pdfSyncResetAll').tap();assert.match(await page.locator('#pdfSyncOrdinal').textContent(),/\/ 4/);assert.equal(await page.locator('#pdfFollowMode').inputValue(),'manual');await page.locator('#pdfSyncUndo').tap();assert.match(await page.locator('#pdfSyncOrdinal').textContent(),/\/ 5/);assert.equal(await page.evaluate(()=>JSON.stringify({cues:song.cues,analysis:song.chordAnalysis})),original);await page.locator('#enableAutoPdf').tap();await page.evaluate(()=>{audio.currentTime=0;});await editor();await page.waitForFunction(()=>document.querySelector('#pdfSyncSection').textContent==='C');await page.locator('#pdfSyncTargets [data-key="1:2"]').tap();await page.waitForFunction(()=>!busy&&song.chordAnalysis.changes[0].name==='F'&&document.querySelector('#pdfSyncSection').textContent==='F');assert.match(await page.locator('#pdfSyncPickHint').textContent(),/Chord bars, matching and PDF follow/);assert.equal(await page.locator('#pdfSyncTargets .saved').getAttribute('data-key'),'1:2');assert.deepEqual(await page.evaluate(()=>song.chordAnalysis.changes.slice(1).map(c=>c.name)),['Am','F',null]);await page.locator('#enableAutoPdf').tap();await at(1,'1:2');await page.reload();await page.waitForFunction(()=>pageReady&&!document.querySelector('#pdfFollowMode').disabled);assert.equal(await page.evaluate(()=>song.chordAnalysis.changes[0].name),'F');await at(1,'1:2');assert.deepEqual(errors,[]);console.log('PASS skipped detections hold PDF, long chords split by bar, repeated same/different printed spots, stable anchors, restore/Undo, saved playback and unchanged analysis/manual cues');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});