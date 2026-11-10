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
 if(p==='/api/chord-practice/start'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{lastStart=JSON.parse(body);starts++;if(failStart){res.statusCode=400;return json({message:'Connect a microphone first.'});}state={id:'test',status:'running',first:lastStart.first,second:lastStart.second,target:lastStart.first,correctChords:0,changes:0,remaining:60,rms:.02,saved:false};json(state);});return;}
 if(p.endsWith('/save')){state.saved=true;state.error='';return json(state);}
 if(p.endsWith('/cancel')){state.status='cancelled';return json(state);}
 const f=path.resolve(root,'.'+p);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(f));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const checks=[];function check(name,value){assert.ok(value,name);checks.push(name);console.log('PASS',name);}
try{browser=await chromium.launch({headless:true,timeout:30000,...(process.env.GPL_TEST_CHROME?{executablePath:process.env.GPL_TEST_CHROME}:{})});const page=await browser.newPage({viewport:{width:800,height:480},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/practice.html`);
await page.locator('#practiceTab').tap();await page.locator('#timerStart').tap();await page.locator('#oneMinuteChanges').tap();await page.waitForFunction(()=>document.querySelector('#changesDevice').options.length===2);
check('exercise fits touchscreen without page scrollbar',await page.evaluate(()=>document.body.scrollHeight<=480&&document.documentElement.scrollWidth<=800));
await page.waitForFunction(()=>document.querySelector('#changesPairScores').textContent.includes('Last 24 · Personal best 30'));
check('selected pair shows its saved scores',await page.locator('#changesPairScores').isVisible());
check('root and type menus replace the long chord list',await page.locator('#changesFirst option').count()===12&&await page.locator('#changesFirstType option').count()===26);
await page.locator('#changesFirstType').selectOption('m');await page.locator('#changesFirst').selectOption('A');check('root plus minor type updates the diagram',await page.locator('#changesTarget').textContent()==='Play Am');await page.locator('#changesFirst').selectOption('C');await page.locator('#changesFirstType').selectOption('');
check('diagram displayed before start',await page.locator('#changesDiagram svg').count()===1);
await page.locator('#changesSecond').selectOption('D');
check('second selection updates its preview before Start',await page.locator('#changesSecondDiagram svg').getAttribute('aria-label').then(label=>label.startsWith('D,')));
await page.waitForFunction(()=>document.querySelector('#changesPairScores').textContent.includes('No saved scores'));
await page.locator('#changesSecond').selectOption('G');
const originalFirst=await page.locator('#changesDiagram svg').getAttribute('aria-label');
const originalSecond=await page.locator('#changesSecondDiagram svg').getAttribute('aria-label');
await page.locator('#changesFirstNext').tap();
await page.locator('#changesSecondNext').tap();
const selectedSecond=await page.locator('#changesSecondDiagram svg').getAttribute('aria-label');
check('arrows choose independent alternatives',selectedSecond!==originalSecond&&await page.locator('#changesDiagram svg').getAttribute('aria-label')!==originalFirst);

check('Start is available without tuning confirmation',await page.locator('#changesStart').isEnabled()&&await page.locator('#changesTuning').count()===0);
await page.locator('#changesSecond').selectOption('C');await page.locator('#changesStart').tap();check('identical chords rejected without opening mic',starts===0&&await page.locator('#changesMessage').textContent().then(t=>t.includes('different notes')));
await page.locator('#changesSecond').selectOption('G');await page.locator('#changesSecondNext').tap();await page.locator('#changesStart').tap();await page.waitForFunction(()=>document.querySelector('#changesCancel').disabled===false);
check('start displays one-minute countdown and locks chord choices',await page.locator('#changesFirst').isDisabled()&&await page.locator('#changesFirstType').isDisabled()&&await page.locator('#changesSecondType').isDisabled()&&await page.locator('#changesTime').textContent()==='1:00');
state={...state,target:'G',correctChords:1,remaining:54};await page.waitForFunction(()=>document.querySelector('#changesTarget').textContent==='Play G');check('recognition advances target and score',await page.locator('#changesCount').textContent()==='1 chord');
check('running round shows the chosen second shape',await page.locator('#changesDiagram svg').getAttribute('aria-label')===selectedSecond&&await page.locator('#changesSecondPreview').isHidden());

await page.screenshot({path:process.env.GPL_TEST_SCREENSHOT||'/tmp/glab-one-minute.png'});
state={...state,status:'completed',remaining:0,previous:{last:24,best:30},correctChords:31,changes:30,saved:false,error:'Result not saved.'};await page.waitForFunction(()=>!document.querySelector('#changesRetry').hidden);check('unsaved result remains available for retry',await page.locator('#changesStart').isDisabled()&&await page.locator('#changesFirst').isDisabled());await page.locator('#changesRetry').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('Saved on the Pi'));
check('completed result shows score, changes and save status',await page.locator('#changesMessage').textContent().then(t=>t.includes('31 correct chords')&&t.includes('30 changes')));
check('result compares with last round and announces a new best',await page.locator('#changesMessage').textContent().then(t=>t.includes('7 more than last round')&&t.includes('New personal best')));
check('saved score updates pair summary',await page.locator('#changesPairScores').textContent().then(t=>t.includes('Last 31 · Personal best 31')));
await page.locator('#changesHistory').tap();await page.waitForFunction(()=>document.querySelector('#changesResultsList').textContent.includes('31 chords'));check('saved results shown',await page.locator('#changesResultsList').textContent().then(t=>t.includes('31 chords')&&t.includes('30 changes')));await page.locator('#changesCloseResults').tap();
failStart=true;await page.locator('#changesStart').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('Connect a microphone'));check('microphone errors do not start a round',await page.locator('#changesMessage').textContent().then(t=>t.includes('Connect a microphone'))&&await page.locator('#changesCancel').isDisabled());
failStart=false;await page.locator('#changesFirst').selectOption('A');await page.locator('#changesFirstType').selectOption('m');await page.locator('#changesSecond').selectOption('D');await page.locator('#changesSecondType').selectOption('7');await page.locator('#changesStart').tap();await page.waitForFunction(()=>!document.querySelector('#changesCancel').disabled);check('combined names sent and restored correctly',lastStart.first==='Am'&&lastStart.second==='D7'&&await page.locator('#changesFirstType').inputValue()==='m'&&await page.locator('#changesSecondType').inputValue()==='7');await page.locator('#changesCancel').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('cancelled'));check('cancelled rounds explicitly not saved',await page.locator('#changesMessage').textContent().then(t=>t.includes('not saved')));
await page.locator('#changesBack').tap();check('returns to existing practice timer',await page.locator('#practice').isVisible()&&await page.locator('#chordChanges').isHidden());check('existing practice timer pauses while doing the exercise',await page.locator('#timerStart').textContent()==='Resume');
await page.locator('#oneMinuteChanges').tap();await page.waitForFunction(()=>document.querySelector('#changesDevice').options.length===2);
await page.locator('#changesDevice').selectOption('plughw:CARD=USB,DEV=0');
await page.locator('#changesBack').tap();
const devicesLoaded=page.waitForResponse(r=>r.url().endsWith('/devices'));
await page.locator('#oneMinuteChanges').tap();await devicesLoaded;
check('selected microphone survives reopening the exercise',await page.locator('#changesDevice').inputValue()==='plughw:CARD=USB,DEV=0');
await page.locator('#changesRecent').selectOption({label:'Am → D7'});
check('Recent restores both roots and qualities',await page.locator('#changesFirst').inputValue()==='A'&&await page.locator('#changesFirstType').inputValue()==='m'&&await page.locator('#changesSecond').inputValue()==='D'&&await page.locator('#changesSecondType').inputValue()==='7');
await page.locator('#changesFirstNext').tap();
await page.locator('#changesSecondNext').tap();
const savedDiagrams=await page.locator('#changesPreviews svg').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
await page.locator('#changesBack').tap();
await page.reload();await page.locator('#practiceTab').tap();await page.locator('#oneMinuteChanges').tap();
await page.locator('#changesRecent').selectOption({label:'Am → D7'});
check('Recent restores both selected chord shapes after reload',JSON.stringify(savedDiagrams)===JSON.stringify(await page.locator('#changesPreviews svg').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')))));
await page.goto(`http://127.0.0.1:${server.address().port}/practice.html?tab=tools`);
await page.evaluate(()=>{
 window.chimeNotes=[];
 const original=sound;
 sound=(frequency,...args)=>{window.chimeNotes.push(frequency);original(frequency,...args);};
});
await page.locator('#tunerTab').tap();
await page.waitForFunction(()=>document.querySelector('#tuning').textContent.includes('In tune'));
check('guitar tuner starts automatically with the saved Pi mic',await page.locator('#tunerDevice').inputValue()==='plughw:CARD=USB,DEV=0'&&await page.locator('#tunerListen').count()===0);
check('live pitch auto-selects and tunes the A string',await page.locator('#note').textContent()==='A2'&&await page.locator('#tuning').textContent()==='✓ In tune');
check('tuner highlights the heard string and shows a 100% score',await page.locator('#strings .heard').textContent()==='A2'&&await page.locator('#tunerScoreMeter').evaluate(m=>m.value)===100);
check('tuner neck and controls fit on the Pi screen',await page.evaluate(()=>document.querySelector('#strings').getBoundingClientRect().height>=210&&document.querySelector('.tuner-controls').getBoundingClientRect().bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));
if(process.env.GPL_TUNER_SCREENSHOT)await page.screenshot({path:process.env.GPL_TUNER_SCREENSHOT});
await page.waitForTimeout(600);
check('steady in-tune signal plays a single two-note chime',await page.evaluate(()=>window.chimeNotes.length===2));
liveFrequency=null;
await page.waitForFunction(()=>!document.querySelector('#strings .heard'));
check('tuner keeps the last score when the string stops ringing',await page.locator('#tunerLastScore').textContent()==='Last string · A2 · 100%');
liveFrequency=144;
await page.waitForFunction(()=>document.querySelector('#strings .string-out-of-tune')?.textContent==='D3');
check('the current string turns orange while the previous string stays green',
 await page.locator('#strings .string-in-tune').textContent()==='A2'&&await page.locator('#strings .heard').textContent()==='D3');
for(const [note,frequency] of [['E2',82.41],['D3',146.83],['G3',196],['B3',246.94],['E4',329.63]]){
 liveFrequency=frequency;
 await page.waitForFunction(name=>[...document.querySelectorAll('#strings .string-in-tune')].some(button=>button.textContent===name),note);
}
check('all six green strings show Guitar in tune',await page.locator('#guitarInTune').isVisible());
liveFrequency=324;
await page.waitForFunction(()=>document.querySelector('#strings .string-out-of-tune')?.textContent==='E4');
check('a later out-of-tune reading clears the guitar checkmark',await page.locator('#guitarInTune').isHidden()&&await page.locator('#strings .string-in-tune').count()===5);
liveFrequency=110;
await page.locator('#strings').getByRole('button',{name:'D3'}).tap();
await page.waitForFunction(()=>document.querySelector('#tuning').textContent.includes('Flat'));
check('manual string selection measures against the chosen string',await page.locator('#note').textContent()==='D3');
check('guitar tuner defaults to standard tuning',await page.locator('#tunerTuning').inputValue()==='standard');
liveFrequency=73.4162;
await page.locator('#tunerTuning').selectOption('dropD');
await page.locator('#strings').getByRole('button',{name:'D2',exact:true}).tap();
await page.waitForFunction(()=>document.querySelector('#tunerLastScore').textContent==='Last string · D2 · 100%'
 &&document.querySelector('#strings .string-in-tune')?.textContent==='D2');
check('Drop D changes the low string target and clears previous tuning results',
 await page.locator('#strings .string-in-tune').count()===1&&await page.locator('#note').textContent()==='D2');
liveFrequency=110;
await page.locator('#menuBack').tap();
for(let tries=0;!closedStreams&&tries<20;tries++)await page.waitForTimeout(50);
check('leaving tuner stops microphone capture',closedStreams>0);
await page.goto(`http://127.0.0.1:${server.address().port}/scale-practice.html`);
await page.locator('#scaleMic').check();
await page.locator('#play').tap();
await page.waitForFunction(()=>document.querySelector('#target').textContent==='C');
check('Follow the Notes advances on the correct live note',await page.locator('#message').textContent()==='Correct. Play the next highlighted note.');
await page.locator('#play').tap();
await page.goto(`http://127.0.0.1:${server.address().port}/practice.html?tab=practice`);
await page.getByRole('button',{name:'Chord Clean Check'}).tap();
await page.locator('#chord').selectOption('C');
const shapeBefore=await page.locator('#cleanDiagram svg').getAttribute('aria-label');
await page.locator('#nextShape').tap();
check('Chord Clean Check arrows change the diagram',await page.locator('#cleanDiagram svg').getAttribute('aria-label')!==shapeBefore);
await page.locator('#previousShape').tap();
await page.locator('#tuning').selectOption('dropD');
check('alternate tuning appears in the diagram',await page.locator('#cleanDiagram svg').textContent().then(text=>text.includes('D → E')));
await page.locator('#tuning').selectOption('standard');
await page.locator('#capo').selectOption('2');
check('capo raises the expected pitch',await page.locator('#cleanStrings .current').textContent()==='String 5 · D3');
await page.locator('#start').tap();
await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Heard A2'));
liveFrequency=146.8324;
await page.waitForFunction(()=>document.querySelector('#cleanStrings .correct'));
check('Chord Clean Check flags a wrong pitch and advances on the right one',await page.locator('#cleanStrings .correct').count()===1);
await page.locator('#start').tap();
await page.getByRole('link',{name:'‹ Back'}).tap();
await page.getByRole('button',{name:'Strumming Timing'}).tap();
await page.locator('#tempo').selectOption('120');
check('Strumming Timing starts in silent visual mode',await page.locator('#beatMode').inputValue()==='visual');
await page.locator('#beatMode').selectOption('audio');
await page.locator('#start').tap();
await page.waitForFunction(()=>document.querySelector('#timingResult').textContent.includes('on beat'),{},{timeout:25000});
check('Strumming Timing scores all 32 beats and distinguishes early, late, and missed',
 await page.locator('#beatGrid .beat').count()===32&&await page.locator('#beatGrid .on-time').count()>20
 &&await page.locator('#beatGrid .early').count()>0&&await page.locator('#beatGrid .late').count()>0&&await page.locator('#beatGrid .missed').count()>0);
check('audible click alone does not count as a strum',await page.locator('#beatGrid .beat').nth(3).textContent()==='Missed');
check('no JavaScript errors',errors.length===0);console.log(checks.length+' exercise UI checks passed.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});
