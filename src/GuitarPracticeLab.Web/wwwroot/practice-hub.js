(()=>{
 'use strict';
 const tabs=[...document.querySelectorAll('.practice-categories [role="tab"]')],key='guitar-practice-focus';
 function select(id,remember=false){
  const selected=tabs.find(tab=>tab.id===id)||tabs[0];
  for(const tab of tabs){const on=tab===selected;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!on;}
  if(remember)try{localStorage.setItem(key,selected.id);}catch{}
 }
 for(const [index,tab]of tabs.entries()){
  tab.onclick=()=>select(tab.id,true);
  tab.addEventListener('keydown',event=>{
   const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
   if(next===null)return;event.preventDefault();select(tabs[next].id,true);tabs[next].focus();
  });
 }
 let saved;try{saved=localStorage.getItem(key);}catch{}select(saved);
})();
