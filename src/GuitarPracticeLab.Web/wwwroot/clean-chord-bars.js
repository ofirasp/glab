/* Clean view presentation uses the same bar boundaries and chord timeline. */
(function(scope){
  'use strict';
  function layout({time,windowBar,windowStart,windowEnd,bar,pulse,pulses,anchor,timeline,matched=()=>false}){
    const bars=[];
    function at(moment){let index=-1;for(let i=0;i<timeline.length;i++){if(timeline[i].time>moment)break;index=i;}return timeline[index];}
    for(let group=windowBar;group<=windowBar+1;group++){
      const left=Math.max(windowStart,anchor+group*bar),right=Math.min(windowEnd,anchor+(group+1)*bar);
      if(right<=left)continue;
      const number=group-windowBar+1;
      const cuts=[left,...timeline.filter(change=>change.time>left+.001&&change.time<right-.001).map(change=>change.time),right];
      const segments=[];
      for(let i=0;i<cuts.length-1;i++){
        const from=cuts[i],to=cuts[i+1],change=at(from+.001),current=time>=from&&time<to;
        const hit=Boolean(change&&matched(change.sourceIndex)&&time>=from);
        const label=`Bar ${number}`+(current?' · Current':time>=to?' · Played':i?' · Next change':'')+(hit?' · matched ✓':'');
        const ticks=[];
        for(let count=0;count<pulses;count++){
          const onset=anchor+group*bar+count*pulse,a=Math.max(from,onset),b=Math.min(to,onset+pulse);
          if(b<=a+.00001)continue;
          ticks.push({number:count+1,weight:(b-a)/pulse,progress:Math.max(0,Math.min(1,(time-a)/(b-a))),current:time>=a&&time<b});
        }
        segments.push({name:change?.name||'',sourceIndex:change?.sourceIndex,from,to,current,matched:hit,label,fraction:(to-from)/bar,ticks});
      }
      bars.push({number,fraction:(right-left)/bar,current:time>=left&&time<right,segments});
    }
    return bars;
  }
  function render(target,options){
    const root=document.createElement('div');root.className='clean-chord-bars';root.setAttribute('role','img');root.setAttribute('aria-label','Chord bars in '+options.meter);
    for(const bar of layout(options)){
      const container=document.createElement('div');container.className='clean-bar';container.dataset.bar=bar.number;container.style.flexGrow=bar.fraction;
      if(bar.current)container.classList.add('current-bar');
      if(bar.segments.length&&bar.segments.every(segment=>segment.matched))container.classList.add('matched-bar');
      for(const segment of bar.segments){
        const card=document.createElement('div');card.className='clean-chord-segment';card.classList.toggle('current',segment.current);card.classList.toggle('matched',segment.matched);card.style.flexGrow=segment.fraction;
        card.dataset.chordSegment=segment.name;card.dataset.barFraction=Number(segment.fraction.toFixed(6));card.dataset.matched=segment.matched;if(segment.sourceIndex!==undefined)card.dataset.sourceIndex=segment.sourceIndex;
        card.setAttribute('aria-label',(segment.name||'No chord')+' · '+segment.label);
        const line=document.createElement('div');line.className='clean-chord-line';
        const name=document.createElement('strong');name.textContent=segment.name||'—';name.title=segment.name;
        const label=document.createElement('small');label.textContent=segment.label;label.title=segment.label;if(segment.matched)label.dataset.matchCheck=segment.sourceIndex;
        line.append(name,label);
        const track=document.createElement('div');track.className='clean-beat-track';
        for(const tick of segment.ticks){
          const pill=document.createElement('span');pill.className='clean-beat-pill';pill.style.flexGrow=tick.weight;pill.dataset.pulse=tick.number;pill.dataset.state=tick.progress===1?'done':tick.current?'current':'remaining';pill.setAttribute('aria-label',`Beat pulse ${tick.number} · ${pill.dataset.state}`);
          const fill=document.createElement('i');fill.style.width=(tick.progress*100)+'%';pill.append(fill);track.append(pill);
        }
        card.append(line,track);container.append(card);
      }
      root.append(container);
    }
    target.replaceChildren(root);
  }
  scope.CleanChordBars={layout,render};
})(typeof window==='undefined'?globalThis:window);
