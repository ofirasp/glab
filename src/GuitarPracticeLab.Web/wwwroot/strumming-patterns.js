((root)=>{
 'use strict';
 function grid(meter='4/4'){if(!['2/4','3/4','4/4','6/8','9/8','12/8'].includes(meter))throw Error('Choose a supported time signature.');const beats=Number(meter.split('/')[0]),subdivisions=meter.endsWith('/4')?2:1;return {beats,subdivisions,length:beats*subdivisions};}
 function defaults(meter){const g=grid(meter);return Array.from({length:g.length},(_,i)=>i%g.subdivisions===0?'D':'-');}
 function validate(pattern,meter){const g=grid(meter);if(pattern===undefined||pattern===null)return defaults(meter);if(!Array.isArray(pattern)||pattern.length!==g.length||pattern.some(s=>!['D','U','-'].includes(s))||!pattern.some(s=>s!=='-'))throw Error('Choose at least one strum and use the slots for this time signature.');return [...pattern];}
 const arrow=stroke=>stroke==='D'?'↓':stroke==='U'?'↑':'—';
 function label(pattern,meter){const g=grid(meter),p=validate(pattern,meter);return Array.from({length:g.beats},(_,i)=>p.slice(i*g.subdivisions,(i+1)*g.subdivisions).map(arrow).join('')).join(' ');}
 function presets(meter){const g=grid(meter),items=[{name:'↓ on each beat',slots:defaults(meter)},{name:'↓↑ alternating eighths',slots:Array.from({length:g.length},(_,i)=>i%2?'U':'D')}];if(meter==='4/4')items.push({name:'↓  ↓↑  ↑↓',slots:['D','-','D','U','-','U','D','-']},{name:'↓  ↓↑  ↑↓↑',slots:['D','-','D','U','-','U','D','U']});return items;}
 const api={grid,defaults,validate,arrow,label,presets};root.StrumPatterns=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
