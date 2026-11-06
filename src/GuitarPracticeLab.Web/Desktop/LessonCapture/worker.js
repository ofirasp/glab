/* Metadata only, in the dedicated lesson profile. No page scripts, cookies or content. */
importScripts('config.js');
const appOrigin=new URL(GUITAR_LESSON_CONFIG.appUrl).origin;
const key=id=>'lesson-window-'+id;
async function remember(tabId){
 try{
  const tab=await chrome.tabs.get(tabId);if(!tab.active||!tab.url)return;
  const url=new URL(tab.url);if(!['http:','https:'].includes(url.protocol)||url.origin===appOrigin||url.username||url.password)return;
  await chrome.storage.session.set({[key(tab.windowId)]:{url:url.href,title:(tab.title||url.hostname).slice(0,160),tabId:tab.id,capturedAt:Date.now()}});
 }catch{}
}
chrome.tabs.onActivated.addListener(info=>{remember(info.tabId);});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url||change.title||change.status==='complete')remember(id);});
chrome.runtime.onMessageExternal.addListener((message,sender,respond)=>{
 (async()=>{
  let page;try{page=new URL(sender.url);}catch{return respond({error:'Unrecognized return page.'});}
  if(page.origin!==appOrigin||page.pathname!=='/lesson-return.html'||message?.action!=='currentLesson')return respond({error:'This request is only available from the Practice return tab.'});
  let windowId=sender.tab?.windowId;
  if(windowId===undefined){const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});windowId=tabs[0]?.windowId;}
  const saved=(await chrome.storage.session.get(key(windowId)))[key(windowId)];
  respond(saved?{lesson:saved}:{error:'Open a lesson in the other tab, then return here to save it.'});
 })().catch(()=>respond({error:'Could not read the lesson tab. Return to the lesson and try again.'}));
 return true;
});
