((root)=>{
 'use strict';
 const timing=root.GuitarStrumTiming||(typeof require==='function'?require('./guitar-strum-timing.js'):null);
 const patterns=root.StrumPatterns||(typeof require==='function'?require('./strumming-patterns.js'):null);
 class BarChordRound{
  constructor({first,second,bpm,changes,meter='4/4',pattern}){
   if(!first||!second||first===second||!Number.isFinite(bpm)||bpm<20||bpm>180||!Number.isInteger(changes)||changes<1||changes>128)throw Error('Choose different chords, tempo 20–180, and 1–128 changes.');
   if(!['2/4','3/4','4/4','6/8','9/8','12/8'].includes(meter))throw Error('Choose a supported time signature.');
   Object.assign(this,{first,second,bpm,changes,meter});this.beats=Number(meter.split('/')[0]);this.compound=meter.endsWith('/8');this.beat=60/bpm/(this.compound?3:1);this.bar=this.beat*this.beats;this.duration=(changes+1)*this.bar;this.matched=new Set();this.pending=null;this.attacks=new Map();this.extraStrums=0;this.lastAttackTime=-Infinity;this.timingWindow=Math.min(.18,this.beat*.4);this.lastStrum=null;
   this.pattern=patterns.validate(pattern,meter);this.subdivisions=patterns.grid(meter).subdivisions;this.slotDuration=this.beat/this.subdivisions;
   const strokes=this.pattern.map((stroke,slot)=>({stroke,slot,time:slot*this.slotDuration})).filter(s=>s.stroke!=='-');
   this.strumStep=Math.min(...strokes.map((s,i)=>(strokes[(i+1)%strokes.length].time+(i===strokes.length-1?this.bar:0))-s.time));
   this.timingWindow=Math.min(this.timingWindow,this.strumStep*.45);this.targets=[];this.targetBySlot=new Map();
   for(let barIndex=0;barIndex<=changes;barIndex++)for(const stroke of strokes){const target={...stroke,time:barIndex*this.bar+stroke.time,index:this.targets.length,barIndex,beat:Math.floor(stroke.slot/this.subdivisions)};this.targets.push(target);this.targetBySlot.set(barIndex+':'+stroke.slot,target);}

  }
  at(time){
   if(time<0)return null;
   const index=Math.min(this.changes,Math.floor(time/this.bar));
   return {index,target:index%2?this.second:this.first,next:index%2?this.first:this.second,beat:Math.min(this.beats-1,Math.floor((time-index*this.bar)/this.beat)),matched:this.matched.has(index),done:time>=this.duration};
  }
  observe(chord,time){
   if(!Number.isFinite(time)||time<0||time>=this.duration)return false;
   const state=this.at(time);
   if(!state.index||chord!==state.target){this.pending=null;return false;}
   if(this.matched.has(state.index))return false;
   const p=this.pending;
   if(!p||p.index!==state.index||time<p.last||time-p.last>.5){this.pending={index:state.index,start:time,last:time};return false;}
   p.last=time;
   if(time-p.start<.08)return false;
   this.matched.add(state.index);this.pending=null;return true;
  }
  strum(time){
   if(!Number.isFinite(time)||time< -this.beat*.49||time>=this.duration)return false;
   let low=0,high=this.targets.length;while(low<high){const mid=(low+high)>>1;if(this.targets[mid].time<time)low=mid+1;else high=mid;}
   let target=this.targets[Math.min(low,this.targets.length-1)];if(low>0&&Math.abs(this.targets[low-1].time-time)<Math.abs(target.time-time))target=this.targets[low-1];
   const index=target.index,offset=time-target.time;
   const previousTime=this.targets[index-1]?.time??(this.targets.at(-1).time-this.duration),nextTime=this.targets[index+1]?.time??(this.targets[0].time+this.duration);
   const acceptance=Math.min(this.beat*.49,(target.time-previousTime)*.49,(nextTime-target.time)*.49);

   const previous=this.attacks.get(index),closer=previous!==undefined&&Math.abs(offset)<Math.abs(previous)-.015;
   if(!closer&&time-this.lastAttackTime<Math.min(.18,this.strumStep*.45))return false;
   this.lastAttackTime=Math.max(this.lastAttackTime,time);
   if(Math.abs(offset)>acceptance||previous!==undefined&&!closer){this.extraStrums++;return false;}
   this.attacks.set(index,offset);this.lastStrum={index,slot:target.slot,beat:target.beat,stroke:target.stroke,offset,status:timing.classify(offset,this.timingWindow)};return true;
  }
  strumResult(){
   const expected=this.targets.length,window=this.timingWindow,offsets=[...this.attacks.values()];
   const onTime=offsets.filter(v=>Math.abs(v)<=window).length,early=offsets.filter(v=>v< -window).length,late=offsets.filter(v=>v>window).length;
   return {expected,detected:offsets.length,onTime,early,late,missed:expected-offsets.length,extra:this.extraStrums,accuracy:Math.round(onTime/expected*100),toleranceMs:Math.round(window*1000),meanOffsetMs:offsets.length?Math.round(offsets.reduce((a,b)=>a+b,0)/offsets.length*1000):null};
  }
  result(){const matches=this.matched.size;return {first:this.first,second:this.second,bpm:this.bpm,meter:this.meter,pattern:[...this.pattern],changes:this.changes,matches,accuracy:Math.round(matches/this.changes*100),strumming:this.strumResult()};}
 }
 root.BarChordRound=BarChordRound;
 if(typeof module!=='undefined')module.exports=BarChordRound;
})(typeof window==='undefined'?globalThis:window);
