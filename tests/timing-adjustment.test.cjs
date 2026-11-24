const assert=require('node:assert/strict');const storage=new Map();global.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
require('../src/GuitarPracticeLab.Web/wwwroot/timing-adjustment.js');
const helper=GuitarTimingAdjustment,pulses=Array.from({length:8},(_,i)=>1+i*.75);
assert.equal(helper.estimate(pulses.map(t=>t+.14),pulses).milliseconds,140);
assert.equal(helper.estimate(pulses.map(t=>t-.1),pulses).milliseconds,-100);
assert.ok(helper.estimate([1.1,1.85],pulses).error);
assert.ok(helper.estimate(pulses.map((t,i)=>t+(i%2?.25:-.25)),pulses).error);
helper.save('mic-a',140);helper.save('mic-b',-50);assert.equal(helper.get('mic-a'),140);assert.equal(helper.get('mic-b'),-50);assert.equal(helper.get('missing'),0);
helper.save('mic-a',5000);assert.equal(helper.get('mic-a'),500);
storage.set('guitar-microphone-timing-v1','bad json');assert.equal(helper.get('mic-a'),0);helper.save('mic-a',30);assert.equal(helper.get('mic-a'),30);
console.log('PASS calibration estimates positive/negative offsets, rejects incomplete/irregular strums, saves per microphone and bounds corrections');

const plan=helper.schedule(1,40);assert.equal(plan.period,1.5);assert.deepEqual(plan.countIn,[1,2.5,4,5.5]);assert.equal(plan.strums[0],7);assert.equal(plan.strums.length,8);assert.equal(helper.schedule(0,60).period,1);
console.log('PASS calibration uses four count-in beats then eight single slow strum pulses');
