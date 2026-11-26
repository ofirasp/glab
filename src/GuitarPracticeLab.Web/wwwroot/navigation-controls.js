(()=>{
 'use strict';
 const svg=path=>{const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','22');icon.setAttribute('height','22');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','2');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');icon.innerHTML='<path d="'+path+'"/>';return icon;};
 function decorate(control,kind,label){if(control.dataset.navigationIcon===kind&&control.querySelector('svg'))return;control.dataset.navigationIcon=kind;control.classList.add(kind==='close'?'ui-dialog-close':'ui-nav-back');control.setAttribute('aria-label',label);control.title=label;const hidden=document.createElement('span');hidden.className='ui-navigation-label';hidden.textContent=control.textContent.trim();control.replaceChildren(svg(kind==='close'?'M6 6l12 12M18 6 6 18':'M19 12H5m6-6-6 6 6 6'),hidden);}
 function scan(node){
  if(!(node instanceof HTMLElement))return;const controls=node.matches('button,a')?[node]:[...node.querySelectorAll('button,a')];
  for(const control of controls){const label=control.textContent.trim(),dialog=control.closest('dialog');
   if(dialog&&control.matches('button')&&(control.dataset.close||label==='Close'||label==='Cancel'||control.id==='pdfSyncClose'||/^Close\b/.test(control.getAttribute('aria-label')||''))){dialog.classList.add('ui-dialog');decorate(control,'close',control.getAttribute('aria-label')||(label==='Cancel'?'Cancel':'Close'));}
   else if(!dialog&&(/^(?:[‹←<]\s*)?Back$/.test(label)||control.id==='menuBack'||control.id==='changesBack')){const header=control.closest('header,.changeshead');if(!control.dataset.navigationIcon&&header&&header.firstElementChild!==control&&!control.hidden)header.prepend(control);decorate(control,'back','Back');}
  }
 }
 scan(document.body);
 new MutationObserver(records=>{for(const record of records){const target=record.target instanceof Element?record.target:record.target.parentElement;if(target?.matches('button,a'))scan(target);for(const node of record.addedNodes)scan(node);}}).observe(document.body,{childList:true,subtree:true});
})();
