const {chromium}=require('playwright');
const fs=require('node:fs'), path=require('node:path'), http=require('node:http'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
let take=null, wav;
const id='11111111-1111-1111-1111-111111111111';
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://local');
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(url.pathname==='/api/chord-practice/devices')return json({available:true,devices:['default']});
 if(url.pathname==='/api/chord-practice/record-loop'){
  res.setHeader('Content-Type','application/octet-stream');
  const block=Buffer.alloc(2048);
  const send=()=>res.write(block);
  send();const clock=setInterval(send,40);res.on('close',()=>clearInterval(clock));return;
 }
 if(url.pathname==='/api/guitar-loops'){
  if(req.method==='GET')return json(take?[take]:[]);
  const chunks=[];
  req.on('data',chunk=>chunks.push(chunk));
  req.on('end',()=>{
   wav=Buffer.concat(chunks);assert.equal(wav.toString('ascii',0,4),'RIFF');
   take={id,name:url.searchParams.get('name'),seconds:(wav.length-44)/32000};json(take);
  });return;
 }
 if(url.pathname==='/api/guitar-loops/'+id+'/audio'){res.setHeader('Content-Type','audio/wav');return res.end(wav);}
 if(url.pathname==='/api/guitar-loops/'+id&&req.method==='DELETE'){take=null;res.statusCode=204;return res.end();}
 const file=path.resolve(root,'.'+url.pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});
  const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/practice.html?tab=tools`);
  await page.getByRole('button',{name:/^Looper/}).tap();
  await page.waitForFunction(()=>!document.querySelector('#recordLoop').disabled);
  await page.locator('#recordLoop').tap();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('● Recording'));
  await page.waitForTimeout(200);
  await page.evaluate(()=>document.dispatchEvent(new Event('guitar-looper-toggle')));
  await page.locator('#loopName').fill('Fingerpicking');
  await page.locator('#previewLoop').tap();
  await page.waitForFunction(()=>!document.querySelector('#loopAudio').paused);
  assert.equal(await page.locator('#loopAudio').evaluate(audio=>audio.loop),true);
  await page.locator('#saveLoop').tap();
  await page.getByRole('button',{name:'Play Fingerpicking'}).waitFor();
  await page.reload();
  await page.getByRole('button',{name:'Play Fingerpicking'}).tap();
  await page.waitForFunction(()=>!document.querySelector('#loopAudio').paused);
  await page.getByRole('button',{name:'Delete Fingerpicking'}).tap();
  await page.locator('#removeLoop').tap();
  await page.waitForFunction(()=>document.querySelector('#loops').textContent.includes('No saved loops'));
  assert.equal(await page.locator('#loopAudio').evaluate(audio=>audio.paused),true);
  assert.deepEqual(errors,[]);
  console.log('PASS recording, pedal-ready event, WAV preview, persistence after reload, loop playback, and deletion');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
