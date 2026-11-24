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
let imported=false,importShift=null,importMeter=null;const importedSong={...make('55555555-5555-5555-5555-555555555555',[]),title:'Artist - Song - Chords',hasAudio:false};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/song-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(imported?[importedSong]:[]));}
 if(url.pathname==='/api/song-library/pdf'&&req.method==='POST'){req.resume();imported=true;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(importedSong));}
 if(url.pathname.endsWith('/match-audio')){importedSong.hasAudio=true;importedSong.audioName='Artist_Song-original.mp3';res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({song:importedSong,matched:true,message:'Matching original MP3 attached automatically.'}));}
 if(url.pathname.endsWith('/analyze-chords')){let body='';req.on('data',c=>body+=c);req.on('end',()=>{importShift=JSON.parse(body).shift;importedSong.chordAnalysis={shift:importShift,changes:[{time:0,name:'G'},{time:4,name:'C'}]};setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(importedSong.chordAnalysis));},300);});return;}
 if(url.pathname.endsWith('/rhythm/analyze')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({estimate:{bpm:96,meter:null,firstDownbeat:.5},audioVersion:'test-audio'}));}
 if(url.pathname.endsWith('/rhythm')&&req.method==='PUT'){let body='';req.on('data',c=>body+=c);req.on('end',()=>{importedSong.rhythm=JSON.parse(body).rhythm;importMeter=importedSong.rhythm.meter;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(importedSong));});return;}

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
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});try{const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);await page.waitForSelector('#libraryImport');await page.locator('#libraryImport').tap();await page.locator('#pdfFiles').setInputFiles({name:'Artist - Song - Chords.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});await page.locator('#importCapo').selectOption('3');assert.equal(await page.locator('#importAnalyze').isChecked(),true);assert.equal(await page.locator('#doImport').evaluate(e=>e.getBoundingClientRect().bottom<=480),true);await page.screenshot({path:'/tmp/glab-import-setup.png'});await page.locator('#doImport').tap();await page.waitForFunction(()=>document.querySelector('#importStatus').textContent.includes('Analyzing chords'));await page.waitForFunction(()=>!document.querySelector('#importDialog').open&&!document.querySelector('#play').disabled);assert.equal(importShift,3);assert.equal(importMeter,'4/4');assert.equal(await page.evaluate(()=>song.hasAudio&&song.chordAnalysis.shift===3&&song.rhythm.meter==='4/4'),true);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('guitar-chords-'+song.id)).capo),3);assert.match(await page.locator('#status').textContent(),/default; meter unclear/);assert.deepEqual(errors,[]);console.log('PASS Pi import controls, automatic MP3 attachment, selected capo analysis, 4/4 fallback, saved song selection and progress feedback');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});