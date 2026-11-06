(function(){
'use strict';const el=id=>document.getElementById(id);let lesson=null,saving=false,generation=0;
function status(text){el('captureStatus').textContent=text;}
async function load(){
 const current=++generation;lesson=null;el('saveCurrentLesson').disabled=true;el('captureTitle').textContent='Reading the lesson tab…';el('captureUrl').textContent='';
 try{
  const response=await fetch('/api/lessons/browser',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Could not reach the app.');const browser=await response.json();
  if(!browser.available||!browser.captureId)throw Error('Restart the Pi once after installing this update to enable automatic lesson saving.');
  if(!window.chrome?.runtime?.sendMessage)throw Error('The lesson capture helper is not loaded. Close the lesson browser, restart the Pi and try again.');
  const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('The lesson helper did not respond. Return to the lesson and try again.')),5000);
   chrome.runtime.sendMessage(browser.captureId,{action:'currentLesson'},value=>{clearTimeout(timeout);if(chrome.runtime.lastError)reject(Error('The lesson helper is unavailable. Restart the Pi after the update.'));else resolve(value);});
  });
  if(current!==generation)return;if(result?.error)throw Error(result.error);
  const url=new URL(result.lesson.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('This page does not have a saveable web address.');
  lesson={url:url.href,title:(result.lesson.title||url.hostname).trim().slice(0,160)||url.hostname};
  el('captureTitle').textContent=lesson.title;el('captureUrl').textContent=lesson.url;el('saveCurrentLesson').disabled=false;status('Last lesson viewed in this window. Tap Save to keep its link.');
 }catch(e){if(current===generation){el('captureTitle').textContent='No lesson ready to save';status(e.message);}}
}
el('saveCurrentLesson').onclick=async()=>{
 if(!lesson||saving)return;saving=true;el('saveCurrentLesson').disabled=true;el('refreshLesson').disabled=true;
 try{const response=await fetch('/api/lessons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:lesson.title,url:lesson.url,notes:'',preserveExisting:true})});const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.message||result.detail||'Could not save the lesson.');status('Saved on the Pi. Find it under Lessons → Saved lessons.');el('saveCurrentLesson').textContent='Saved ✓';}
 catch(e){status(e.message);el('saveCurrentLesson').disabled=false;}finally{saving=false;el('refreshLesson').disabled=false;}
};
el('refreshLesson').onclick=()=>{el('saveCurrentLesson').textContent='Save current lesson';load();};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!saving){el('saveCurrentLesson').textContent='Save current lesson';load();}});
window.addEventListener('focus',()=>{if(!saving){el('saveCurrentLesson').textContent='Save current lesson';load();}});
el('returnPractice').onclick=async()=>{el('returnStatus').textContent='Returning to practice…';try{const response=await fetch('/api/lessons/browser/return',{method:'POST'});if(!response.ok)throw Error('Could not close this lesson window. Use its normal Close button.');}catch(e){el('returnStatus').textContent=e.message;}};
load();
})();
