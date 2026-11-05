// Run with Playwright available via NODE_PATH and GPL_TEST_CHROME set if needed.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
// A small valid WAV recording, generated locally, is served as audio for the test.
const samples=48000*20,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
const make=(id,cues)=>({id,title:cues.length?'With cues':'Without cues',pages:1,hasAudio:true,hasBacking:false,audioName:'test.wav',duration:20,notes:'',cues,updated:'test'});
const songs=[make('11111111-1111-1111-1111-111111111111',[{time:0,page:1,position:0,pageAnchor:0,label:'Intro',zoom:1}]),make('22222222-2222-2222-2222-222222222222',[])];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/song-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(songs));}
 if(url.pathname.endsWith('/chords')){res.setHeader('Content-Type','application/json');return res.end('[]');}
 if(url.pathname.includes('/page/')){res.setHeader('Content-Type','image/png');return res.end(png);}
 if(url.pathname.endsWith('/audio')){res.setHeader('Content-Type','audio/wav');return res.end(wav);}
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
 await page.goto(`http://127.0.0.1:${server.address().port}/song-library.html`);
 const openSong=async title=>{if(!await page.locator('#libraryDialog').isVisible())await page.locator('#libraryButton').tap();await page.locator('.songrow').filter({hasText:title}).getByRole('button',{name:'Open',exact:true}).tap();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);};
 const isOn=()=>page.locator('#follow').getAttribute('aria-pressed').then(v=>v==='true');
 await openSong('With cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 check('autoplay enables Follow for a song with cues',await isOn());
 await page.locator('#follow').tap();check('manual off still works during playback',!await isOn());
 await page.locator('#play').tap();await page.locator('#play').tap();await page.waitForFunction(()=>!document.querySelector('#audio').paused);
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');
 check('pause and resume enables Follow again',await isOn());
 await page.locator('#follow').tap();await page.locator('#readerToggle').tap();await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('reading view Play enables Follow',await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#follow').tap();await page.locator('#readerTools').tap();await page.locator('#toolsPlay').tap();
 await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('tools Play enables Follow',await isOn());await page.locator('#toolsDialog [data-close]').tap();
 await openSong('Without cues');await page.waitForFunction(()=>!document.querySelector('#audio').paused);check('songs without cues keep Follow off',!await isOn());
 await page.locator('#readerPlay').tap();await page.locator('#readerPlay').tap();check('no-cue resume stays off',!await isOn());
 await openSong('With cues');await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('returning to a cued song enables Follow',await isOn());
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#markCue').disabled);
 check('restoring last song does not autoplay',await page.locator('#audio').evaluate(a=>a.paused));
 await page.locator('#readerPlay').tap();await page.waitForFunction(()=>document.querySelector('#follow').getAttribute('aria-pressed')==='true');check('Play after browser reload enables Follow',await isOn());
 check('no JavaScript errors',!errors.length);
 console.log(`${checks.length} auto-follow checks passed.`);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
