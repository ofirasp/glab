(function(scope){
  'use strict';
  const key='guitar-microphone-timing-v1';
  const limit=value=>Number.isFinite(value)?Math.max(-500,Math.min(500,Math.round(value))):0;
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;};
  function get(device){try{return limit(JSON.parse(localStorage.getItem(key)||'{}')[device]);}catch{return 0;}}
  function save(device,value){let values={};try{const saved=JSON.parse(localStorage.getItem(key)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))values={...saved};}catch{}values[device]=limit(value);localStorage.setItem(key,JSON.stringify(values));}
  function estimate(onsets,pulses){
    const matched=new Map();
    for(const onset of onsets){let index=-1,distance=.34;for(let i=0;i<pulses.length;i++){const d=Math.abs(onset-pulses[i]);if(d<distance){index=i;distance=d;}}if(index>=0&&!matched.has(index))matched.set(index,onset-pulses[index]);}
    const offsets=[...matched.values()];
    if(offsets.length<4)return {error:'Not enough clear strums. Try again with steady muted strums.',count:offsets.length};
    const centre=median(offsets),spread=median(offsets.map(value=>Math.abs(value-centre)));
    if(spread>.08)return {error:'Strums varied too much. Try again with a steady pulse.',count:offsets.length};
    return {milliseconds:limit(centre*1000),count:offsets.length,spreadMs:Math.round(spread*1000)};
  }
  function schedule(start,bpm=40){
    const period=60/([40,60].includes(Number(bpm))?Number(bpm):40);
    return {period,countIn:Array.from({length:4},(_,i)=>start+i*period),strums:Array.from({length:8},(_,i)=>start+(i+4)*period)};
  }
  scope.GuitarTimingAdjustment={get,save,estimate,limit,schedule};
})(typeof window==='undefined'?globalThis:window);
