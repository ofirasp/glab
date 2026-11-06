// Requires Chromium/Chrome for Testing, an isolated app and a prepared capture extension.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
 const base=process.env.GPL_TEST_URL||'http://127.0.0.1:5108',extension=path.resolve(process.env.GPL_TEST_EXTENSION||'work/lesson-tests/capture-bridge/capture-extension'),bridge=path.dirname(extension);
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))),id=crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 const beat=()=>fs.writeFileSync(path.join(bridge,'status.json'),JSON.stringify({heartbeat:Date.now()/1000,available:true,running:true,error:'',captureId:id}));beat();const heartbeat=setInterval(beat,800);
 let context;const checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name)};
 try{
  context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,timeout:30000,...(process.env.GPL_TEST_CHROME?{executablePath:process.env.GPL_TEST_CHROME}:{}),viewport:{width:800,height:480},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});check('real Chromium extension loads with stable ID',worker.url().includes(id));
  await context.route('https://www.justinguitar.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<title>Song library</title><button onclick="history.pushState({},\'\',\'/songs/iris?t=12#chords\');document.title=\'Iris — Guitar lesson\'">Open Iris lesson</button>'}));
  const back=await context.newPage();await back.goto(base+'/lesson-return.html');
  const lesson=await context.newPage();await lesson.goto('https://www.justinguitar.com/songs');await lesson.bringToFront();await lesson.getByRole('button',{name:'Open Iris lesson'}).click();
  for(let i=0;i<30;i++){const values=await worker.evaluate(()=>chrome.storage.session.get(null));if(Object.values(values).some(v=>v.url?.includes('/songs/iris?t=12#chords')&&v.title==='Iris — Guitar lesson'))break;await new Promise(r=>setTimeout(r,100));}
  await back.bringToFront();await back.locator('#refreshLesson').click();await back.waitForFunction(()=>!document.querySelector('#saveCurrentLesson').disabled);
  check('captures navigated lesson, not the original library URL',await back.locator('#captureUrl').textContent()==='https://www.justinguitar.com/songs/iris?t=12#chords');
  check('captures title without keyboard input',await back.locator('#captureTitle').textContent()==='Iris — Guitar lesson');
  check('return screen fits touchscreen',await back.evaluate(()=>document.body.scrollHeight<=480&&document.documentElement.scrollWidth<=800));
  await back.locator('#saveCurrentLesson').click();await back.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('Saved on the Pi'));
  let rows=await (await context.request.get(base+'/api/lessons')).json();const saved=rows.find(r=>r.url==='https://www.justinguitar.com/songs/iris?t=12#chords');check('one tap saves actual title and URL on server',saved?.title==='Iris — Guitar lesson');
  await context.request.put(base+'/api/lessons/'+saved.id,{data:{title:'My Iris lesson',url:saved.url,notes:'Keep these practice notes.'}});
  await back.locator('#refreshLesson').click();await back.waitForFunction(()=>!document.querySelector('#saveCurrentLesson').disabled);await back.locator('#saveCurrentLesson').click();await back.waitForFunction(()=>document.querySelector('#captureStatus').textContent.includes('Saved on the Pi'));
  rows=await (await context.request.get(base+'/api/lessons')).json();check('repeat capture preserves saved notes and avoids duplicates',rows.filter(r=>r.url===saved.url).length===1&&rows.find(r=>r.id===saved.id).notes==='Keep these practice notes.'&&rows.find(r=>r.id===saved.id).title==='My Iris lesson');
  const denied=await lesson.evaluate(async extensionId=>new Promise(resolve=>chrome.runtime.sendMessage(extensionId,{action:'currentLesson'},response=>resolve(response?.lesson?response:response?.error||chrome.runtime.lastError?.message||'no response'))),id).catch(()=> 'blocked');
  check('external lesson website cannot read remembered lesson metadata',typeof denied==='string');
  await back.screenshot({path:process.env.GPL_TEST_SCREENSHOT||'/tmp/glab-save-current-lesson.png'});
  await back.locator('#returnPractice').click();await back.waitForTimeout(150);check('return control still sends close request',JSON.parse(fs.readFileSync(path.join(bridge,'request.json'))).action==='close');
  console.log(checks.length+' real-browser lesson capture checks passed.');
 }finally{clearInterval(heartbeat);if(context)await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
