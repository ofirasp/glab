const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');let state=null,starts=0,failStart=false,lastStart=null,closedStreams=0,liveFrequency=110;
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;const json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
 if(p==='/api/chord-practice/devices')return json({available:true,devices:['default','plughw:CARD=USB,DEV=0']});
 if(p==='/api/chord-practice/listen'){
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   assert.equal(JSON.parse(body).device,'plughw:CARD=USB,DEV=0');
   res.setHeader('Content-Type','application/x-ndjson');
   const send=()=>res.write(JSON.stringify({frequency:liveFrequency})+'\n');
   send();
   const timer=setInterval(send,150);
   res.on('close',()=>{clearInterval(timer);closedStreams++;});
  });
  return;
 }
 if(p==='/api/chord-practice/record'){
  res.setHeader('Content-Type','application/octet-stream');
  let samples=0;
  const send=()=>{
   const block=Buffer.alloc(2048);
   for(let i=0;i<1024;i++,samples++){
    const time=samples/16000;
    const beat=Math.round((time-2.244)/.5);
    const offset=beat===1?.15:beat===2?-.15:0;
    const since=time-(2.244+beat*.5+offset);
    const clickTime=time-(2.244+beat*.5);
    const click=clickTime>=0&&clickTime<.045
      ? 15000*Math.sin(2*Math.PI*(beat%4===0?2400:1800)*clickTime)*Math.min(1,clickTime/.005)*Math.exp(-clickTime/.017) : 0;
    const strum=beat>=0&&beat<32&&beat!==3&&since>=0&&since<.04 ? 8500*Math.sin(2*Math.PI*180*since) : 0;
    block.writeInt16LE(Math.round(click+strum),2*i);
   }
   res.write(block);
  };
  send();const timer=setInterval(send,64);
  res.on('close',()=>clearInterval(timer));
  return;
 }
 if(p==='/api/chord-practice/active')return json(state);
 if(p==='/api/chord-practice/scores'){
  const query=new URL(req.url,'http://local').searchParams;
  const isKnown=[query.get('first'),query.get('second')].sort().join(',')==='C,G';
  return json(isKnown?{last:24,best:30}:{last:null,best:null});
 }
 if(p==='/api/chord-practice/history')return json([{first:'C',second:'G',correctChords:31,changes:30,finished:new Date().toISOString()}]);
 if(p==='/api/chord-practice/start'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{lastStart=JSON.parse(body);starts++;if(failStart){res.statusCode=400;return json({message:'Connect a microphone first.'});}state={id:'test-'+starts,status:'running',first:lastStart.first,second:lastStart.second,target:lastStart.first,correctChords:0,changes:0,remaining:60,rms:.02,saved:false};json(state);});return;}
 if(p.endsWith('/save')){state.saved=true;state.error='';return json(state);}
 if(p.endsWith('/cancel')){state.status='cancelled';return json(state);}
 const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(f));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.GPL_TEST_CHROME});const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/mic-practice.html?mode=timing`);await page.waitForFunction(()=>!document.querySelector('#start').disabled);await page.locator('#tempo').selectOption('120');await page.locator('#device').selectOption('plughw:CARD=USB,DEV=0');await page.evaluate(()=>localStorage.setItem('guitar-microphone-timing-v1',JSON.stringify({'plughw:CARD=USB,DEV=0':168})));await page.locator('#beatMode').selectOption('audio');await page.locator('#start').tap();await page.waitForFunction(()=>document.querySelector('#strumBarPosition').textContent==='Bar 1 of 8');assert.equal(await page.locator('#beatGrid').isVisible(),false);assert.equal(await page.locator('.settings').isVisible(),false);assert.equal(await page.locator('#strumPulseRing').isVisible(),true);await page.waitForTimeout(800);await page.screenshot({path:'/tmp/glab-strum-live-new.png'});await page.waitForFunction(()=>document.querySelector('#changesRoundResult').open,{},{timeout:25000});assert.equal(await page.locator('#beatGrid .beat').count(),32);assert.equal(await page.locator('#beatGrid .on-time').count()>20,true);assert.equal(await page.locator('#beatGrid .beat').nth(3).textContent(),'Missed');assert.equal(await page.locator('#strumTimingTrace circle').count(),32);assert.equal(await page.locator('#changesRoundResult').evaluate(e=>e.scrollHeight<=e.clientHeight&&e.getBoundingClientRect().bottom<=480),true);assert.equal(await page.locator('#beatGrid .beat').first().evaluate(e=>e.getBoundingClientRect().width<10),true);await page.waitForTimeout(1000);await page.screenshot({path:'/tmp/glab-strum-result-new.png'});await page.locator('#strumResultReview').tap();assert.equal(await page.locator('.settings').isVisible(),true);await page.locator('#start').tap();await page.waitForTimeout(500);await page.locator('#start').tap();assert.equal(await page.locator('.settings').isVisible(),true);assert.deepEqual(errors,[]);console.log('PASS animated live target, hidden grid/settings, 32-beat trace and dots, accuracy, click rejection, compact results, retry and cancel');}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});