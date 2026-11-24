/* Timing is estimated from stable microphone detections, in song seconds. */
(function(scope) {
  'use strict';
  function create(changes, map = name => name) {
    const events = [];
    let previous = null;
    for (const change of changes) {
      const name = change.name && map(change.name);
      if (!name || name === previous) continue;
      events.push({name, time:change.time}); previous = name;
    }
    // The opening chord has no preceding chord change to time.
    const transitions = events.slice(1).map((event, i) => ({...event,
      window: Math.min(2, (event.time-events[i].time)/2,
        events[i+2] ? (events[i+2].time-event.time)/2 : 2)}));
    const measured = new Map();
    let candidate = null, stable = null, lastTime = -Infinity;
    function observe(name, time, playbackRate = 1) {
      if (!Number.isFinite(time) || time <= lastTime) return null;
      lastTime = time;
      if (!name) { candidate = null; return null; }
      if (name === stable) { candidate = null; return null; }
      if (!candidate || candidate.name !== name || time-candidate.last > .5) {
        candidate = {name, time, last:time}; return null;
      }
      if (time-candidate.time < .04) return null;
      stable = name;
      const onset = candidate.time;
      candidate = null;
      let best = -1, distance = Infinity;
      for (let i=0;i<transitions.length;i++) {
        const event = transitions[i], delta = Math.abs(onset-event.time);
        if (event.name === name && !measured.has(i) && delta <= event.window && delta < distance) {
          best = i; distance = delta;
        }
      }
      if (best < 0) return null;
      const offset = (onset-transitions[best].time) / (playbackRate > 0 ? playbackRate : 1);
      const score = Math.max(0, 1-Math.max(0, Math.abs(offset)-.15)/.85);
      const feedback = {offset, score, label:Math.abs(offset)<=.15 ? 'On time ✓' : offset<0 ? 'Early' : 'Late'};
      measured.set(best, feedback);
      return feedback;
    }
    function result() {
      const values = [...measured.values()], count = values.length, total = transitions.length;
      return {percent: total ? Math.round(100*values.reduce((sum,v)=>sum+v.score,0)/total) : null,
        total, detected:count, missed:total-count,
        averageMs:count ? Math.round(1000*values.reduce((sum,v)=>sum+v.offset,0)/count) : null,
        averageErrorMs:count ? Math.round(1000*values.reduce((sum,v)=>sum+Math.abs(v.offset),0)/count) : null};
    }
    return {observe, result, resetInput() {candidate=null; stable=null; lastTime=-Infinity;}};
  }
  scope.ChordChangeTiming = {create};
})(typeof window === 'undefined' ? globalThis : window);
