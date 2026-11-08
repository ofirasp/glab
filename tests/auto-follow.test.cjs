// Run with Playwright available via NODE_PATH and GPL_TEST_CHROME set if needed.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const sheet='<svg xmlns="http://www.w3.org/2000/svg" width="500" height="2000"><rect width="500" height="2000" fill="white"/></svg>';
// A small valid WAV recording, generated locally, is served as audio for the test.
const samples=48000*20,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
const make=(id,cues)=>({id,title:cues.length?'With cues':'Without cues',pages:1,hasAudio:true,hasBacking:false,audioName:'test.wav',duration:20,notes:'',cues,updated:'test'});
const songs=[make('11111111-1111-1111-1111-111111111111',[{time:0,page:1,position:0,pageAnchor:0,label:'Intro',zoom:1}]),make('22222222-2222-2222-2222-222222222222',[])];
songs[0].pages=2;
songs[0].cues.push({time:4,page:1,position:.6,label:'Middle',zoom:1});
songs[0].cues.push({time:5,page:2,position:0,pageAnchor:0,label:'Verse',zoom:1});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/song-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(songs));}
 if(url.pathname==='/api/song-library/'+songs[0].id+'/simple'){
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pages:2,updated:'simple-test'}));
 }
 if(url.pathname.endsWith('/chords')){res.setHeader('Content-Type','application/json');return res.end('[]');}
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
 check('FullScreen starts with the lower controls collapsed',await page.locator('#readerPlay').isHidden()&&await page.locator('#follow').isHidden()&&await page.locator('#readerMute').isHidden());
 await page.locator('#readerControlsToggle').tap();
 check('Controls reveals cue, playback and volume rows',await page.locator('#follow').isVisible()&&await page.locator('#readerPlay').isVisible()&&await page.locator('#readerMute').isVisible());
 await page.locator('#readerControlsToggle').tap();check('Hide controls collapses the panel again',await page.locator('#readerPlay').isHidden());
 await page.locator('#readerControlsToggle').tap();
 await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('reading view Play enables Follow',await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#follow').tap();await page.locator('#readerTools').tap();await page.locator('#toolsPlay').tap();
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('tools Play enables Follow',await isOn());await page.locator('#toolsDialog [data-close]').tap();
 await openSong('Without cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);check('songs without cues keep Follow off',!await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();check('no-cue resume stays off',!await isOn());
 await openSong('With cues');await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('returning to a cued song enables Follow',await isOn());
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);await page.locator('#readerControlsToggle').tap();
 check('restoring last song does not autoplay',await page.locator('#audio').evaluate(a=>a.paused));
 await page.locator('#readerPlay').tap();await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('Play after browser reload enables Follow',await isOn());
 check('no JavaScript errors',!errors.length);
 console.log(`${checks.length} auto-follow checks passed.`);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
