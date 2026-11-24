(()=>{
 'use strict';
 const header=document.querySelector('main>header')||document.querySelector('.changeshead');
 if(!header)return;
 const badge=document.createElement('span');badge.id='freePracticeBadge';badge.hidden=true;badge.setAttribute('aria-label','Free practice time remaining');
 const label=document.createElement('small'),time=document.createElement('strong');label.textContent='Free practice';time.setAttribute('role','timer');badge.append(label,time);header.append(badge);
 const update=()=>{
  let saved;try{saved=JSON.parse(localStorage.getItem('guitar-free-practice-timer-v1')||'null');}catch{}
  const mainPage=document.getElementById('practice');
  const exerciseVisible=!mainPage||['chordChanges','tuner','metro'].some(id=>{const e=document.getElementById(id);return e&&!e.hidden;});
  const valid=saved&&Number.isFinite(saved.started)&&saved.started>0&&Number.isFinite(saved.duration)&&Number.isFinite(saved.elapsed);
  const seconds=valid?Math.max(0,Math.ceil((saved.duration-saved.elapsed-Math.max(0,Date.now()-saved.started))/1000)):0;
  badge.hidden=!exerciseVisible||seconds<=0;
  if(!badge.hidden)time.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
 };
 update();setInterval(update,250);window.addEventListener('storage',update);window.addEventListener('guitar-free-timer-change',update);document.addEventListener('guitar-page-change',update);
})();
