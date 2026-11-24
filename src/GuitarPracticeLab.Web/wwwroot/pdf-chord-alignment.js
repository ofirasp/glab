((root)=>{
'use strict';
function normalize(name){const s=String(name||'').trim().replace(/♯/g,'#').replace(/♭/g,'b').replace(/Δ/g,'maj').replace(/−/g,'m');const m=/^([A-G])([#b]?)(.*)$/.exec(s);if(!m)return s;const pitch=({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0)+12)%12;return pitch+':'+m[3].replace(/^maj(?=$|\/)/,'').replace(/^min/,'m');}
function positions(pages,direction='auto',titleRtl=false){
 const ordered=[];
 for(const page of pages){
  const rtl=typeof direction==='boolean'?direction:direction==='rtl'||direction==='auto'&&(page.rightToLeft===true||titleRtl);
  const pageHits=(page.chords||[]).map((hit,i)=>({...hit,page:page.number,key:page.number+':'+i})).filter(h=>h.name&&[h.x,h.y,h.width,h.height].every(Number.isFinite)&&h.height>0).sort((a,b)=>(a.y+a.height/2)-(b.y+b.height/2));
  const lines=[];
  for(const hit of pageHits){const center=hit.y+hit.height/2;let line=lines.at(-1);if(!line||Math.abs(center-line.center)>.5*Math.min(hit.height,line.height)){line={center,height:hit.height,hits:[]};lines.push(line);}line.hits.push(hit);line.center=line.hits.reduce((sum,h)=>sum+h.y+h.height/2,0)/line.hits.length;line.height=Math.min(line.height,hit.height);}
  for(const line of lines){line.hits.sort((a,b)=>rtl?b.x-a.x:a.x-b.x);ordered.push(...line.hits);}
 }
 return ordered;
}
function align(changes,hits,anchors={},skips={}){
 if(changes.length>1500||hits.length>3000)throw Error('This sheet is too large for automatic sync. Use manual follow.');
 const rows=[];
 changes.forEach((c,sourceIndex)=>{if(skips[sourceIndex]||!c.name||!Number.isFinite(c.time))return;const n=normalize(c.name);const choices=[];hits.forEach((h,j)=>{if(normalize(h.name)===n&&(!anchors[sourceIndex]||anchors[sourceIndex]===h.key))choices.push(j);});if(choices.length>120)throw Error('Too many repeated chords. Use manual follow for this sheet.');if(choices.length)rows.push({sourceIndex,time:c.time,name:n,choices});});
 if(!rows.length)return changes.map((c,i)=>({sourceIndex:i,time:c.time,hit:null,confident:false,skipped:!!skips[i]}));
 const cost=(a,b,repeated=false)=>b>a?Math.min(3,(b-a-1)*.14):b===a?(repeated?0:1.8):3.5+Math.min(2,(a-b)*.025);
 const forward=[],back=[],parents=[];
 rows.forEach((row,i)=>{forward[i]=row.choices.map(j=>i?Infinity:j*.06);parents[i]=row.choices.map(()=>-1);if(i)row.choices.forEach((j,k)=>rows[i-1].choices.forEach((prev,l)=>{const score=forward[i-1][l]+cost(prev,j,row.name===rows[i-1].name);if(score<forward[i][k]){forward[i][k]=score;parents[i][k]=l;}}));});
 for(let i=rows.length-1;i>=0;i--){back[i]=rows[i].choices.map(()=>0);if(i<rows.length-1)rows[i].choices.forEach((j,k)=>{back[i][k]=Math.min(...rows[i+1].choices.map((next,l)=>cost(j,next,rows[i].name===rows[i+1].name)+back[i+1][l]));});}
 let k=forward.at(-1).indexOf(Math.min(...forward.at(-1)));const chosen=[];for(let i=rows.length-1;i>=0;i--){chosen[i]=k;k=parents[i][k];}
 const result=changes.map((c,i)=>({sourceIndex:i,time:c.time,hit:null,confident:false,skipped:!!skips[i]}));
 rows.forEach((row,i)=>{const k=chosen[i],j=row.choices[k],score=forward[i][k]+back[i][k];const alternative=Math.min(...row.choices.map((other,l)=>other===j?Infinity:forward[i][l]+back[i][l]));const confident=!!anchors[row.sourceIndex]||alternative-score>=.65;result[row.sourceIndex]={sourceIndex:row.sourceIndex,time:row.time,hit:hits[j],confident,margin:alternative-score};});return result;
}
// A saved later bar can resolve earlier uncertain bars of the same held detection only.
function resolveHeldBars(entries,changes,hits,anchors={},skips={}){
 const result=entries.map(e=>({...e}));
 for(let i=0;i<changes.length;i++){
  if(!changes[i].repeat||!anchors[i]||skips[i]||!result[i]?.confident||!result[i]?.hit)continue;
  const chosen=result[i].hit,end=hits.findIndex(h=>h.key===chosen.key),name=normalize(chosen.name);
  for(let j=i-1;j>=0&&changes[j].source===changes[i].source;j--){
   if(skips[j]||anchors[j]||result[j].confident)break;
   const start=hits.findIndex(h=>h.key===result[j].hit?.key);
   const sameRun=start>=0&&start<=end&&hits.slice(start,end+1).every(h=>normalize(h.name)===name);
   result[j]={...result[j],hit:sameRun?result[j].hit:chosen,confident:true};
  }
 }
 return result;
}
// Promote an edited PDF-only bar boundary into a real chord change.
// Preserve all other marks by time when source indexes shift after insertion.
function editSection(analysis,sections,index,state,name,hitKey){
 const section=sections[index];if(!section||!analysis.changes[section.source])throw Error('Choose a chord section.');
 const draft=structuredClone(analysis),kept=structuredClone(state);
 if(section.repeat){
  const existing=draft.changes.findIndex(c=>Math.abs(c.time-section.time)<.001);
  if(existing>=0)draft.changes[existing].name=name;
  else{draft.changes.push({time:section.time,name});draft.changes.sort((a,b)=>a.time-b.time);}
 }else draft.changes[section.source].name=name;
 const remap=id=>{
  const [sourceText,timeText]=id.split('@'),source=Number(sourceText),old=analysis.changes[source];
  if(!old)return null;
  const time=timeText===undefined?old.time:Number(timeText);if(!Number.isFinite(time))return null;
  let target=draft.changes.findIndex(c=>Math.abs(c.time-old.time)<.001);
  if(source===section.source&&time>=section.time-.001){target=0;for(let i=0;i<draft.changes.length&&draft.changes[i].time<=time+.001;i++)target=i;}
  if(target<0)return null;
  return String(target)+(time>draft.changes[target].time+.001?'@'+time.toFixed(3):'');
 };
 const move=values=>{const result={};for(const [id,value]of Object.entries(values||{})){const next=remap(id);if(next!==null)result[next]=value;}return result;};
 kept.anchors=move(kept.anchors);kept.skips=move(kept.skips);
 const repeats=new Map();for(const repeat of kept.repeats||[]){const id=remap(repeat.source+'@'+repeat.time.toFixed(3));if(id?.includes('@'))repeats.set(id,{source:Number(id.split('@')[0]),time:repeat.time});}kept.repeats=[...repeats.values()];
 const selectedId=remap(section.id??String(section.source));kept.anchors[selectedId]=hitKey;delete kept.skips[selectedId];
 return {analysis:draft,state:kept,selectedId};
}
// Preserve PDF marks across timeline insertions/deletions using their actual times.
function migrateTimelineState(previous,next,state){
 const kept=structuredClone(state),before=previous.changes,after=next.changes;
 const remap=id=>{
  const [sourceText,timeText]=id.split('@'),source=Number(sourceText),old=before[source];if(!old)return null;
  const time=timeText===undefined?old.time:Number(timeText);if(!Number.isFinite(time))return null;
  let target=after.findIndex(c=>Math.abs(c.time-time)<.001);
  // A deleted original section loses only its own marks; do not attach them to a different chord.
  if(target<0&&timeText===undefined)return null;
  if(target<0){for(let i=0;i<after.length&&after[i].time<=time;i++)target=i;}
  if(target<0||normalize(after[target].name)!==normalize(old.name))return null;
  return String(target)+(time>after[target].time+.001?'@'+time.toFixed(3):'');
 };
 const move=values=>{const result={};for(const[id,value]of Object.entries(values||{})){const key=remap(id);if(key!==null)result[key]=value;}return result;};
 kept.anchors=move(kept.anchors);kept.skips=move(kept.skips);const repeats=new Map();
 for(const repeat of kept.repeats||[]){const id=remap(repeat.source+'@'+repeat.time.toFixed(3));if(id?.includes('@'))repeats.set(id,{source:Number(id.split('@')[0]),time:repeat.time});}
 kept.repeats=[...repeats.values()];return kept;
}
function indexAt(time,changes,rhythm,skips={}){
 const bpm=rhythm?.bpm,anchor=Number.isFinite(rhythm?.firstDownbeat)?rhythm.firstDownbeat:0;
 const pulse=Number.isFinite(bpm)&&bpm>0?60/bpm/(rhythm.meter?.endsWith('/8')?3:1):null;
 let selected=-1;
 for(let i=0;i<changes.length;i++){const c=changes[i];if(skips[i]||!c.name)continue;const boundary=pulse?anchor+Math.round((c.time-anchor)/pulse)*pulse:c.time;if(boundary<=time+.00001)selected=i;else break;}
 return selected;
}
const api={normalize,positions,align,indexAt,resolveHeldBars,editSection,migrateTimelineState};root.PdfChordAlignment=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
