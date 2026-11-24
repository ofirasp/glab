(function(scope){
  'use strict';
  function at(rhythm,time){
    if(!rhythm)return null;
    const points=rhythm.points||[];
    let active=-1;
    for(let i=0;i<points.length;i++){if(points[i].time>time)break;active=i;}
    const point=points[active];
    return {...rhythm,...(point?{bpm:point.bpm,meter:point.meter,firstDownbeat:point.time}:{}),
      pointNumber:active+1,sectionStart:point?.time??0,sectionEnd:points[active+1]?.time??Infinity};
  }
  function put(rhythm,time){
    const current=at(rhythm,time);
    const points=(rhythm.points||[]).filter(point=>Math.abs(point.time-time)>.25);
    points.push({time,bpm:current.bpm,meter:current.meter});
    points.sort((a,b)=>a.time-b.time);
    return {...rhythm,points};
  }
  function barAt(rhythm,time){
    const current=at(rhythm,time),beats={'2/4':2,'3/4':3,'4/4':4,'5/4':5,'7/4':7,'6/8':2,'9/8':3,'12/8':4}[current?.meter];
    if(!beats||!Number.isFinite(time)||!Number.isFinite(current.bpm)||current.bpm<=0)return null;
    const duration=60/current.bpm*beats,anchor=Number.isFinite(current.firstDownbeat)?current.firstDownbeat:0;
    const index=Math.floor((time-anchor)/duration+1e-7),start=anchor+index*duration;
    return {start,end:Math.min(start+duration,current.sectionEnd),duration,number:index+1,pointNumber:current.pointNumber};
  }
  scope.SongRhythmPoints={at,put,barAt};
})(typeof window==='undefined'?globalThis:window);
