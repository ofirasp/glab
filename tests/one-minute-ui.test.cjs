const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');let state=null,starts=0,failStart=false,lastStart=null;
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;const json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
 if(p==='/api/chord-practice/devices')return json({available:true,devices:['default','plughw:CARD=USB,DEV=0']});
 if(p==='/api/chord-practice/active')return json(state);
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
check('root and type menus replace the long chord list',await page.locator('#changesFirst option').count()===12&&await page.locator('#changesFirstType option').count()===26);
await page.locator('#changesFirstType').selectOption('m');await page.locator('#changesFirst').selectOption('A');check('root plus minor type updates the diagram',await page.locator('#changesTarget').textContent()==='Play Am');await page.locator('#changesFirst').selectOption('C');await page.locator('#changesFirstType').selectOption('');
check('diagram displayed before start',await page.locator('#changesDiagram svg').count()===1);
await page.locator('#changesSecond').selectOption('D');
check('second selection updates its preview before Start',await page.locator('#changesSecondDiagram svg').getAttribute('aria-label').then(label=>label.startsWith('D,')));
await page.locator('#changesSecond').selectOption('G');
const originalFirst=await page.locator('#changesDiagram svg').getAttribute('aria-label');
const originalSecond=await page.locator('#changesSecondDiagram svg').getAttribute('aria-label');
await page.locator('#changesFirstNext').tap();
await page.locator('#changesSecondNext').tap();
const selectedSecond=await page.locator('#changesSecondDiagram svg').getAttribute('aria-label');
check('arrows choose independent alternatives',selectedSecond!==originalSecond&&await page.locator('#changesDiagram svg').getAttribute('aria-label')!==originalFirst);

check('standard tuning confirmation required',await page.locator('#changesStart').isDisabled());await page.locator('#changesTuning').check();
await page.locator('#changesSecond').selectOption('C');await page.locator('#changesStart').tap();check('identical chords rejected without opening mic',starts===0&&await page.locator('#changesMessage').textContent().then(t=>t.includes('different notes')));
await page.locator('#changesSecond').selectOption('G');await page.locator('#changesSecondNext').tap();await page.locator('#changesStart').tap();await page.waitForFunction(()=>document.querySelector('#changesCancel').disabled===false);
check('start displays one-minute countdown and locks chord choices',await page.locator('#changesFirst').isDisabled()&&await page.locator('#changesFirstType').isDisabled()&&await page.locator('#changesSecondType').isDisabled()&&await page.locator('#changesTime').textContent()==='1:00');
state={...state,target:'G',correctChords:1,remaining:54};await page.waitForFunction(()=>document.querySelector('#changesTarget').textContent==='Play G');check('recognition advances target and score',await page.locator('#changesCount').textContent()==='1 chord');
check('running round shows the chosen second shape',await page.locator('#changesDiagram svg').getAttribute('aria-label')===selectedSecond&&await page.locator('#changesSecondPreview').isHidden());

await page.screenshot({path:process.env.GPL_TEST_SCREENSHOT||'/tmp/glab-one-minute.png'});
state={...state,status:'completed',remaining:0,correctChords:31,changes:30,saved:false,error:'Result not saved.'};await page.waitForFunction(()=>!document.querySelector('#changesRetry').hidden);check('unsaved result remains available for retry',await page.locator('#changesStart').isDisabled()&&await page.locator('#changesFirst').isDisabled());await page.locator('#changesRetry').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('Saved on the Pi'));
check('completed result shows score, changes and save status',await page.locator('#changesMessage').textContent().then(t=>t.includes('31 correct chords')&&t.includes('30 changes')));
await page.locator('#changesHistory').tap();await page.waitForFunction(()=>document.querySelector('#changesResultsList').textContent.includes('31 chords'));check('saved results shown',await page.locator('#changesResultsList').textContent().then(t=>t.includes('31 chords')&&t.includes('30 changes')));await page.locator('#changesCloseResults').tap();
failStart=true;await page.locator('#changesStart').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('Connect a microphone'));check('microphone errors do not start a round',await page.locator('#changesMessage').textContent().then(t=>t.includes('Connect a microphone'))&&await page.locator('#changesCancel').isDisabled());
failStart=false;await page.locator('#changesFirst').selectOption('A');await page.locator('#changesFirstType').selectOption('m');await page.locator('#changesSecond').selectOption('D');await page.locator('#changesSecondType').selectOption('7');await page.locator('#changesStart').tap();await page.waitForFunction(()=>!document.querySelector('#changesCancel').disabled);check('combined names sent and restored correctly',lastStart.first==='Am'&&lastStart.second==='D7'&&await page.locator('#changesFirstType').inputValue()==='m'&&await page.locator('#changesSecondType').inputValue()==='7');await page.locator('#changesCancel').tap();await page.waitForFunction(()=>document.querySelector('#changesMessage').textContent.includes('cancelled'));check('cancelled rounds explicitly not saved',await page.locator('#changesMessage').textContent().then(t=>t.includes('not saved')));
await page.locator('#changesBack').tap();check('returns to existing practice timer',await page.locator('#practice').isVisible()&&await page.locator('#chordChanges').isHidden());check('existing practice timer pauses while doing the exercise',await page.locator('#timerStart').textContent()==='Resume');
check('no JavaScript errors',errors.length===0);console.log(checks.length+' exercise UI checks passed.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});
