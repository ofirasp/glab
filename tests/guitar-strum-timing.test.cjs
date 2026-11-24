const assert=require('node:assert/strict'),timing=require('../src/GuitarPracticeLab.Web/wwwroot/guitar-strum-timing.js'),Round=require('../src/GuitarPracticeLab.Web/wwwroot/bar-changes-engine.js');
const rate=16000,bytes=new Uint8Array(rate*3*2),view=new DataView(bytes.buffer);
for(let i=0;i<rate*3;i++){const t=i/rate;let value=0;for(const at of [.2,.7,1.2,1.7])if(t>=at)value+=.35*Math.exp(-14*(t-at))*(Math.sin(2*Math.PI*110*(t-at))+.4*Math.sin(2*Math.PI*220*(t-at)));view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,value))*32767),true);}
const raw=new timing.Detector(),packets=new timing.Detector();const a=raw.process(bytes),b=[];
for(let at=0;at<bytes.length;at+=2711){const encoded=Buffer.from(bytes.subarray(at,at+2711)).toString('base64');b.push(...packets.process(timing.decode(encoded)));}
assert.equal(a.length,4);assert.deepEqual(b,a);a.forEach((t,i)=>assert.ok(Math.abs(t-(.2+i*.5))<.025));assert.equal(packets.samples,rate*3);
const clicks=new Uint8Array(rate*2*2),clickView=new DataView(clicks.buffer);for(let i=0;i<rate*2;i++){const t=i/rate,phase=t% .5;clickView.setInt16(i*2,phase<.045?Math.round(.5*Math.sin(2*Math.PI*2400*t)*32767):0,true);}assert.equal(new timing.Detector().process(clicks).length,0);
assert.equal(timing.classify(-.1),'early');assert.equal(timing.classify(.1),'late');assert.equal(timing.classify(.02),'on-time');assert.equal(timing.classify(null),'missed');
const round=new Round({first:'C',second:'G',bpm:120,changes:1});assert.equal(round.strum(.35),true);assert.equal(round.lastStrum.status,'early');assert.equal(round.strum(.5),true);assert.equal(round.lastStrum.status,'on-time');assert.equal(round.strumResult().detected,1);assert.equal(round.strumResult().extra,0);
console.log('PASS shared raw/base64 PCM detection, odd chunk boundaries, onset times, click rejection, timing labels and closer-strum correction');

const firstBeat=new Round({first:'C',second:'G',bpm:120,changes:1});assert.equal(firstBeat.strum(-.001),true);assert.equal(firstBeat.lastStrum.status,'on-time');assert.equal(firstBeat.strumResult().detected,1);
console.log('PASS first beat accepts a strum one millisecond before the exercise boundary');
