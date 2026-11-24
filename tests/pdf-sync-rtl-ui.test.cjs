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
songs[0].pdfVersion='stable-pdf';songs[0].chordAnalysis={changes:[{time:0,name:'G'},{time:4.23,name:'C'},{time:8,name:'D'},{time:12,name:'G'}]};songs[0].rhythm={bpm:60,meter:'4/4',firstDownbeat:0};
songs[0].title='Hebrew sheet with English filename';songs[0].pages=1;songs[0].chordAnalysis={changes:[{time:0,name:'Am'},{time:4,name:'Em'},{time:8,name:'F'},{time:12,name:'G'}]};
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
  return res.end(JSON.stringify([{number:1,rightToLeft:true,chords:[{name:'Am',x:.85,y:.301,width:.04,height:.02},{name:'Em',x:.7,y:.298,width:.04,height:.02},{name:'F',x:.55,y:.302,width:.03,height:.02},{name:'G',x:.8,y:.4,width:.03,height:.02}]}]));
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
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});try{const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);await page.waitForFunction(()=>typeof selectSong==='function'&&songs.length);await page.evaluate(()=>selectSong(songs[0]));await page.waitForFunction(()=>pageReady);const cues=await page.evaluate(()=>JSON.stringify(song.cues));await page.locator('#toolsButton').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForSelector('#pdfSyncTargets [data-key="1:0"]');await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncSection').textContent==='Em');assert.equal(await page.locator('#pdfSyncPrintedNext').textContent(),'Next on PDF: F');await page.waitForSelector('#pdfSyncTargets [data-key="1:1"]');await page.locator('#pdfSyncTargets [data-key="1:1"]').tap();await page.locator('#pdfSyncDirection').selectOption('ltr');await page.waitForFunction(()=>document.querySelector('#pdfSyncPrintedNext').textContent==='Next on PDF: Am');await page.waitForSelector('#pdfSyncTargets .saved');assert.equal(await page.locator('#pdfSyncTargets .saved').getAttribute('data-key'),'1:1');await page.locator('#pdfSyncDirection').selectOption('rtl');await page.waitForFunction(()=>document.querySelector('#pdfSyncPrintedNext').textContent==='Next on PDF: F');await page.locator('#pdfSyncNext').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncSection').textContent==='F');await page.waitForSelector('#pdfSyncTargets [data-key="1:2"].selected');assert.equal(await page.locator('.pdf-sync-editor-panel').evaluate(e=>e.scrollHeight<=e.clientHeight),true);assert.equal(await page.locator('.pdf-sync-sheet-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await page.locator('#enableAutoPdf').tap();assert.equal(await page.evaluate(()=>JSON.stringify(song.cues)),cues);await page.reload();await page.waitForFunction(()=>pageReady);await page.locator('#toolsButton').tap();await page.locator('#toolsTabAnalyze').tap();await page.locator('#syncPdfButton').tap();await page.waitForFunction(()=>document.querySelector('#pdfSyncDirection').value==='rtl');console.log('PASS Hebrew content detection, jittered right-to-left Em→F order, direction override, preserved corrections/cues, remembered order and 800×480 layout');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});