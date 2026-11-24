((root)=>{
 'use strict';
 // Shared detector extracted from the working Strumming Timing exercise.
 class Detector{
  constructor({minimumGap=.12}={}){this.minimumGap=minimumGap;this.samples=0;this.lowByte=null;this.low=0;this.band=0;this.energy=0;this.broadband=0;this.envelope=0;this.last=-Infinity;this.acceptAfter=-Infinity;}
  process(bytes){
   const attacks=[];
   for(const byte of bytes){
    if(this.lowByte===null){this.lowByte=byte;continue;}
    const input=((this.lowByte|(byte<<8))<<16>>16)/32768;this.lowByte=null;
    this.low+=.18*(input-this.low);this.band+=.18*(this.low-this.band);
    this.energy+=this.band*this.band;this.broadband+=input*input;
    if(++this.samples%160)continue;
    const rms=Math.sqrt(this.energy/160),hasGuitarBand=this.energy>=this.broadband*.12;
    this.energy=this.broadband=0;
    const time=(this.samples-80)/16000,onset=hasGuitarBand&&rms>Math.max(.008,this.envelope*2.2);
    this.envelope=this.envelope*.85+rms*.15;
    if(time<this.acceptAfter||!onset||time-this.last<this.minimumGap)continue;
    this.last=time;attacks.push(time);
   }
   return attacks;
  }
 }
 function classify(offset,tolerance=.08){return offset===null?'missed':offset< -tolerance?'early':offset>tolerance?'late':'on-time';}
 function decode(base64){const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
 const api={Detector,classify,decode};root.GuitarStrumTiming=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
