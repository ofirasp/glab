(function(){
'use strict';const el=id=>document.getElementById(id);let rows=[],editing=null,removing=null,removed=null,busy=false;
const query=new URLSearchParams(location.search),songId=query.get('song');let song=null;
const status=text=>el('lessonStatus').textContent=text;
async function request(path='',options={}){const response=await fetch('/api/lessons'+path,options);const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.message||data.detail||'Lesson operation failed.');return data;}
function open(id){if(!el(id).open)el(id).showModal();}
function edit(item=null){editing=item;el('editHeading').textContent=item?'Edit lesson':'Add Lesson';el('lessonTitle').value=item?.title||'';el('lessonUrl').value=item?.url||'';el('lessonNotes').value=item?.notes||'';el('editError').textContent='';open('lessonEdit');}
async function refresh(){rows=await request();render();}
async function link(url){if(!song)return;try{const response=await fetch('/api/song-library/'+encodeURIComponent(song.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({lessonUrl:url})});const value=await response.json();if(!response.ok)throw Error(value.message||value.detail||'Could not link the lesson.');song=value;status('Lesson linked to '+song.title+'. Return to Songs to watch it.');}catch(e){status(e.message);}}
function render(){const list=el('lessonList');list.replaceChildren();el('lessonCount').textContent=rows.length+' saved';
 if(!rows.length){const empty=document.createElement('div');empty.className='lessonempty';const title=document.createElement('strong');title.textContent='Keep your favourite lessons here';const text=document.createElement('span');text.textContent='Browse a lesson site above, copy the lesson page address, then choose Add Lesson. You can also add links from your Mac.';empty.append(title,text);list.append(empty);}
 for(const row of rows){const card=document.createElement('article');card.className='lessonrow';const info=document.createElement('div'),title=document.createElement('strong'),url=document.createElement('small'),notes=document.createElement('p');title.textContent=row.title;url.textContent=new URL(row.url).hostname;notes.textContent=row.notes;info.append(title,url,notes);const actions=document.createElement('div');actions.className='lessonactions';
  const button=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;actions.append(b);return b;};
  button('Watch ↗',()=>LessonLinks.open(row.url,status)).className='primary';if(song)button('Link to song',()=>link(row.url));button('Edit',()=>edit(row));button('Remove',()=>{removing=row;el('removeTitle').textContent=row.title;open('lessonRemove');});card.append(info,actions);list.append(card);
 }
}
el('refreshLessons').onclick=()=>refresh().then(()=>status('Saved lessons refreshed.')).catch(e=>status(e.message));
el('justin').onclick=()=>LessonLinks.open('https://www.justinguitar.com/songs',status);el('zero').onclick=()=>LessonLinks.open('https://www.guitarzero2hero.com/songs',status);el('addLesson').onclick=()=>edit();
el('saveLesson').onclick=async()=>{if(busy)return;busy=true;el('saveLesson').disabled=true;try{const title=el('lessonTitle').value.trim(),url=LessonLinks.valid(el('lessonUrl').value.trim());if(!title)throw Error('Add a lesson title.');await request(editing?'/'+editing.id:'',{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,url,notes:el('lessonNotes').value})});el('lessonEdit').close();await refresh();status('Lesson saved on the Pi.');}catch(e){el('editError').textContent=e.message;}finally{busy=false;el('saveLesson').disabled=false;}};
el('confirmRemove').onclick=async()=>{if(!removing||busy)return;busy=true;try{await request('/'+removing.id,{method:'DELETE'});removed=removing;el('lessonRemove').close();await refresh();el('undoRemove').hidden=false;status('Removed '+removed.title+'.');}catch(e){status(e.message);}finally{busy=false;}};
el('undoRemove').onclick=async()=>{if(!removed)return;try{await request('/'+removed.id+'/restore',{method:'POST'});removed=null;el('undoRemove').hidden=true;await refresh();status('Saved lesson restored.');}catch(e){status(e.message);}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>el(b.dataset.close).close());
refresh().then(()=>status('Choose a lesson site or watch a saved lesson.')).catch(e=>status(e.message));
if(songId&&/^[0-9a-f-]{36}$/i.test(songId))fetch('/api/song-library').then(r=>r.json()).then(items=>{song=items.find(item=>item.id===songId)||null;if(song){el('lessonsBack').href='/song-library.html';el('songContext').textContent='Link a lesson to '+song.title;render();}}).catch(()=>status('Could not load the selected song. Saved lessons are still available.'));
})();
