(function(){
'use strict';
const openBrowser=window.open.bind(window);
const local=['127.0.0.1','localhost','[::1]'].includes(location.hostname);
const desktop=local&&/Linux/i.test(navigator.userAgent);
function valid(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Use a complete http:// or https:// lesson link.');return u.href;}
async function call(path,data){const response=await fetch('/api/lessons/browser'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});const json=await response.json().catch(()=>({}));if(!response.ok)throw Error(json.message||json.detail||'Could not open the lesson.');return json;}
function pause(){document.querySelectorAll('audio,video').forEach(media=>media.pause());if(typeof window.stopTone==='function')window.stopTone();if(typeof window.stopMetro==='function')window.stopMetro();document.dispatchEvent(new Event('guitar-exercise-open'));document.dispatchEvent(new Event('guitar-open-lesson'));}
async function open(value,notify=()=>{}){
 let url;try{url=valid(value);}catch(e){notify(e.message);return false;}
 pause();
 if(!desktop){
  // Open synchronously during the tap to avoid popup blockers. Never expose our opener.
  const browser=openBrowser('about:blank','_blank','popup,width=1000,height=740');
  if(!browser){notify('Your browser blocked the lesson window. Allow popups for this app and tap again.');return false;}
  browser.opener=null;browser.location.href=url;notify('Lesson opened in another window. Close it to return here.');return true;
 }
 try{
  const status=await call('');if(!status.available)throw Error('Restart the Pi once after installing this update to enable lesson browsing. '+(status.error||''));
  await call('/open',{url});notify('Opening lesson… Use the ← Practice tab in the lesson window to return.');
  for(let attempt=0;attempt<12;attempt++){
   await new Promise(resolve=>setTimeout(resolve,400));const state=await call('');
   if(state.error&&attempt>=2)throw Error(state.error);if(state.running){notify('Lesson opened. Use the ← Practice tab to return.');return true;}
  }
  throw Error('The lesson window did not open. Restart the Pi desktop and try again.');
 }catch(e){notify(e.message);return false;}
}
window.LessonLinks={open,valid};
})();
