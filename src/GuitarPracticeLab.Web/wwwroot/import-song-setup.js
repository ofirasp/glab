(()=>{
'use strict';
async function run(item,{capo=0,capoExplicit=false,analyze=true,existing=false}={},progress=()=>{}){
 const notices=[];
 if(!item.hasAudio){progress('Looking for a matching MP3 on the Pi…');try{const result=await request(`/${item.id}/match-audio`,{method:'POST'});item=result.song;notices.push(result.message);if(item.backingImportMessage)notices.push(item.backingImportMessage);}catch(e){notices.push('Automatic MP3 match: '+e.message);}}
 if(!item.hasAudio)return {item,notices};
 let preferences={};try{preferences=JSON.parse(localStorage.getItem('guitar-chords-'+item.id)||'{}')||{};}catch{}
 const selected=existing&&!capoExplicit?(preferences.capo??item.chordAnalysis?.shift??0):capo;
 const shift=Math.max(0,Math.min(12,Number.isFinite(Number(selected))?Number(selected):0));
 const preservedCorrection=item.chordAnalysis?.corrected;
 if(!preservedCorrection&&(!existing||capoExplicit||!item.chordAnalysis)){preferences.capo=shift;preferences.tuning??='standard';try{localStorage.setItem('guitar-chords-'+item.id,JSON.stringify(preferences));}catch{notices.push('Capo preference could not be saved in this browser.');}}
 if(!analyze)return {item,notices};
 if(preservedCorrection)notices.push('Kept manual chord corrections.');
 else if(!item.chordAnalysis||((!existing||capoExplicit)&&item.chordAnalysis.shift!==shift)){progress('Analyzing chords · capo '+shift+'…');try{item={...item,chordAnalysis:await request(`/${item.id}/analyze-chords`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shift,variant:''})})};notices.push('Chord analysis saved · capo '+shift+'.');}catch(e){notices.push('Chord analysis: '+e.message);}}
 if(!item.rhythm){progress('Analyzing rhythm…');try{const result=await request(`/${item.id}/rhythm/analyze`,{method:'POST'}),estimate=result.estimate;
  if(!Number.isFinite(estimate?.bpm)||estimate.bpm<30||estimate.bpm>300)throw Error('No usable tempo found. Set it in Rhythm.');
  const meter=estimate.meter||'4/4';const firstDownbeat=Number.isFinite(estimate.firstDownbeat)&&estimate.firstDownbeat>=0&&estimate.firstDownbeat<item.duration?estimate.firstDownbeat:null;
  item=await request(`/${item.id}/rhythm`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioVersion:result.audioVersion,rhythm:{...estimate,meter,firstDownbeat,confirmed:false}})});
  notices.push('Rhythm saved · '+estimate.bpm+' BPM · '+meter+(estimate.meter?'.':' (default; meter unclear).'));
 }catch(e){notices.push('Rhythm analysis: '+e.message);}}
 else notices.push('Kept saved rhythm and bar-start adjustments.');
 return {item,notices};
}
window.SongImportSetup={run};
})();
