const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../src/GuitarPracticeLab.Web/wwwroot');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
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
  await page.goto('http://127.0.0.1:'+server.address().port+'/practice.html?tab=practice');
  await page.getByRole('button',{name:'Guess the Chord',exact:true}).tap();
  await page.waitForURL('**/guess-chord.html');
  await page.evaluate(()=>{
   window.lastShape='';window.playedStrings=0;window.fanfareNotes=0;
   const oscillatorStart=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){window.fanfareNotes++;oscillatorStart.apply(this,args);};
   const shapes=GuitarChords.shapes;
   GuitarChords.shapes=(...args)=>{window.lastShape=args[0];return shapes(...args);};
   const start=AudioBufferSourceNode.prototype.start;
   AudioBufferSourceNode.prototype.start=function(...args){
    window.playedStrings++;
    const data=this.buffer.getChannelData(0);
    if(!data.some(value=>Math.abs(value)>.01))throw Error('Silent chord');
    start.apply(this,args);
   };
  });
  assert.equal(await page.locator('#guessLevel option[value="sevenths"]').evaluate(el=>el.disabled),true);
  for(let index=0;index<10;index++){
   const played=await page.evaluate(()=>window.playedStrings);
   await page.locator('#nextGuess').tap();
   await page.waitForFunction(count=>window.playedStrings>count,played);
   const target=await page.evaluate(()=>window.lastShape);
   assert.equal(await page.locator('#answers button').count(),4);
   const names=await page.locator('#answers button').allTextContents();
   assert.equal(new Set(names).size,4);
   assert.equal(await page.locator('#diagram').isHidden(),true);
   const answer=index===0?names.find(name=>name!==target):target;
   await page.locator('#answers').getByRole('button',{name:answer,exact:true}).tap();
   assert.equal(await page.locator('#answers .correct').textContent(),target);
   assert.equal(await page.locator('#diagram svg').count(),1);
   assert.equal(await page.locator('#answers button:enabled').count(),0);
   await page.evaluate(()=>{
    const button=document.querySelector('#answers .correct');
    button.dispatchEvent(new MouseEvent('click'));
   });
   assert.match(await page.locator('#roundProgress').textContent(),new RegExp('Score '+(index||0)+'|Round complete'));
   if(index===0){
    await page.locator('#compareGuess').tap();
    await page.locator('#compareChoices button').first().tap();
    assert.equal(await page.evaluate(()=>document.body.scrollHeight<=480&&document.documentElement.scrollWidth<=800),true);
    assert.equal(await page.locator('#message').evaluate(el=>el.getBoundingClientRect().bottom<=480),true);
    await page.screenshot({path:'/tmp/glab-guess-chord.png'});
   }
  }
  assert.match(await page.locator('#roundProgress').textContent(),/90%.*Longest streak 9/);
  assert.match(await page.locator('#message').textContent(),/mistaken for/);
  assert.equal(await page.locator('#guessLevel option[value="sevenths"]').evaluate(el=>el.disabled),false);
  assert.match(await page.locator('#bestScore').textContent(),/Best 9\/10/);
  assert.equal(await page.locator('#changesRoundResult').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#nextGuess').isDisabled(),true);
  assert.equal(await page.locator('#guessLevel').isDisabled(),true);
  await page.evaluate(()=>{for(let i=0;i<3;i++)document.querySelector('#nextGuess').onclick();});
  assert.match(await page.locator('#roundProgress').textContent(),/Round complete/);
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#changesRoundResult').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#diagram svg').count(),1);
  assert.match(await page.locator('#questionText').textContent(),/Correct/);
  await page.waitForFunction(()=>document.querySelector('#changesRoundResult').open);
  assert.equal(await page.locator('#changesRoundResult').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#guessResultScore').textContent(),'9/10');
  assert.equal(await page.locator('#changesRoundTitle').textContent(),'New personal best!');
  assert.equal(await page.locator('#guessResultLast').textContent(),'—');
  assert.equal(await page.locator('#changesRoundBest').textContent(),'9/10');
  assert.match(await page.locator('#changesRoundSave').textContent(),/saved.*Sevenths unlocked/);
  assert.equal(await page.evaluate(()=>window.fanfareNotes),8);
  assert.equal(await page.locator('#changesRoundResult').evaluate(el=>el.scrollHeight<=el.clientHeight&&el.getBoundingClientRect().bottom<=480),true);
  assert.equal(await page.locator('.changes-round-score').evaluate(el=>el.offsetWidth<250),true);
  await page.screenshot({path:'/tmp/glab-guess-chord-result.png'});
  await page.locator('#changesRoundAgain').tap();
  for(let index=0;index<10;index++){
   if(index)await page.locator('#nextGuess').tap();
   await page.waitForFunction(()=>document.querySelectorAll('#answers button:enabled').length===4);
   await page.waitForTimeout(80);
   const target=await page.evaluate(()=>window.lastShape);
   const names=await page.locator('#answers button').allTextContents();
   await page.locator('#answers').getByRole('button',{name:names.find(name=>name!==target),exact:true}).tap();
  }
  await page.waitForFunction(()=>document.querySelector('#changesRoundResult').open);
  assert.equal(await page.locator('#guessResultScore').textContent(),'0/10');
  assert.equal(await page.locator('#changesRoundTitle').textContent(),'Round complete');
  assert.equal(await page.locator('#guessResultLast').textContent(),'9/10');
  assert.equal(await page.locator('#changesRoundDifference').textContent(),'-9 vs last');
  assert.equal(await page.locator('#changesRoundBest').textContent(),'9/10');
  assert.equal(await page.evaluate(()=>window.fanfareNotes),8);
  await page.locator('#guessResultReview').tap();
  assert.equal(await page.locator('#changesRoundResult').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#diagram svg').count(),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('guitar-guess-chord-progress')).open.rounds),2);
  await page.reload();
  assert.match(await page.locator('#bestScore').textContent(),/Last 0\/10.*Best 9\/10/);
  assert.equal(await page.locator('#guessLevel option[value="sevenths"]').evaluate(el=>el.disabled),false);
  await page.locator('#guessLevel').selectOption('sevenths');
  await page.locator('#nextGuess').tap();
  await page.waitForFunction(()=>document.querySelectorAll('#answers button').length===4);
  assert.deepEqual(errors,[]);
  console.log('PASS ten-question round, plucked audio, four choices, score guard, comparisons, touchscreen fit, unlocks, and saved progress after reload');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
