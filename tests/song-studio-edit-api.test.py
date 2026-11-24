"""Exercise the Mac edit bridge against the real Pi API on a temporary library."""
import base64,contextlib,importlib.util,io,json,os,socket,subprocess,sys,tempfile,time,urllib.request,urllib.error,unittest.mock as mock
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,file);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
remote=module('edit_remote',repo/'tools/mac-song-studio/remote_import.py');worker=module('edit_worker',repo/'tools/mac-song-studio/worker.py')
with tempfile.TemporaryDirectory(prefix='glab-song-images-') as temporary:
 root=Path(temporary);sid='11111111-1111-1111-1111-111111111111';folder=root/'library'/sid.replace('-','');folder.mkdir(parents=True)
 cue={'time':1,'page':1,'position':.3,'zoom':1,'label':'Verse'}
 saved={'id':sid,'title':'Existing song','pages':1,'pdfFile':'original.pdf','notes':'old notes','lessonUrl':'','duration':12,'cues':[cue],'updated':'2026-11-24T00:00:00+00:00'}
 (folder/'song.json').write_text(json.dumps(saved));(folder/'original.pdf').write_bytes(b'%PDF-fixture')
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}/api/song-library'
 env=dict(os.environ,GUITAR_LESSONS=str(root/'lessons'),GUITAR_SONG_LIBRARY=str(root/'library'),GUITAR_RECORDINGS_ROOT=str(root/'recordings'),GUITAR_CHORD_PRACTICE=str(root/'practice'),GPL_LAB_ROOT=str(root/'lab'),ASPNETCORE_ENVIRONMENT='Development')
 def api(path,method='GET',body=None,data=None):
  headers={}
  if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
  with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers,method=method),timeout=15) as response:
   if method=='GET' and path.endswith('/images/'+image_id):return response.read()
   return json.load(response)
 image_id='none'
 with (root/'server.log').open('w') as log:
  process=subprocess.Popen([os.environ['GPL_TEST_DOTNET'],str(repo/'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'),'--urls',f'http://127.0.0.1:{port}'],cwd=repo/'src/GuitarPracticeLab.Web',env=env,stdout=log,stderr=log)
  try:
   for i in range(100):
    try:api('');break
    except Exception:time.sleep(.1)
   rows=remote.execute({'action':'list'},root,api)['songs'];assert rows[0]['notes']=='old notes' and rows[0]['images']==[]
   original_updated=rows[0]['updated']
   song=remote.execute({'action':'edit','songId':sid,'notes':'New notes\nHebrew: שלום','lessonUrl':'https://www.justinguitar.com/songs','expectedUpdated':original_updated},root,api)['song']
   assert song['notes'].startswith('New notes') and song['cues'][0]['label']=='Verse'
   def lessons(method='GET',body=None):
    data=json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api/lessons',data=data,headers={'Content-Type':'application/json'},method=method)) as response:return json.load(response)
   linked=lessons();assert len(linked)==1 and linked[0]['songId']==sid and linked[0]['title']=='Existing song' and linked[0]['url']==song['lessonUrl']
   lessons('POST',{'title':'Old saved title','url':song['lessonUrl'],'notes':'Standalone note'})
   assert len(lessons())==1,'Song link and saved URL must not appear twice'
   song=api('/'+sid,method='PUT',body={'title':'Renamed song','expectedUpdated':song['updated']})
   assert lessons()[0]['title']=='Renamed song'

   try:remote.execute({'action':'edit','songId':sid,'notes':'stale','expectedUpdated':original_updated},root,api);raise AssertionError('stale edit accepted')
   except urllib.error.HTTPError as error:assert error.code==409
   png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=')
   song=remote.execute({'action':'image','songId':sid,'name':'Chord shapes.png','data':base64.b64encode(png).decode()},root,api)['song'];image_id=song['images'][0]['id'];assert api('/'+sid+'/images/'+image_id)==png
   try:api('/'+sid+'/images?name=bad.svg',method='POST',data=b'<svg><script>bad</script></svg>');raise AssertionError('SVG accepted')
   except urllib.error.HTTPError as error:assert error.code==400
   assert len(list(folder.glob('image-*')))==1
   image=root/'reference.png';image.write_bytes(png)
   class FakeSSH:
    def __init__(self,target,password):assert password=='private'
    def connect(self):pass
    def close(self):pass
    def remote(self,config):return remote.execute(config,root,api)
   output=io.StringIO()
   with mock.patch.object(worker,'SSH',FakeSSH),contextlib.redirect_stdout(output):
    worker.run({'action':'edit','target':'ofiras@glab.local','password':'private','songId':sid,'notes':'Worker notes','lessonUrl':'','expectedUpdated':song['updated'],'removeImages':[image_id],'images':[str(image)]})
   events=[json.loads(line[10:]) for line in output.getvalue().splitlines() if line.startswith('GPL_EVENT ')]
   assert events[-1]['type']=='complete' and 'private' not in output.getvalue()
   assert any(event.get('removed')==image_id for event in events)
   latest=api('')[0];assert latest['notes']=='Worker notes' and latest['lessonUrl']=='' and len(latest['images'])==1 and latest['cues'][0]['label']=='Verse'
   image_id=latest['images'][0]['id'];deleted=api('/'+sid+'/images/'+image_id,method='DELETE');assert len(deleted['images'])==0
   assert all(row.get('songId')!=sid for row in lessons()),'Cleared song link must disappear from Lessons'
   target_id='22222222-2222-2222-2222-222222222222';target_folder=root/'library'/target_id.replace('-','');target_folder.mkdir()
   target={**saved,'id':target_id,'title':'Target song','notes':'Keep target notes','lessonUrl':''};(target_folder/'song.json').write_text(json.dumps(target));(target_folder/'original.pdf').write_bytes(b'%PDF-target')
   def mapping(payload):
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api/lessons/song-link',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})) as response:return json.load(response)
   manual=lessons()[0]
   mapping({'lessonId':manual['id'],'songId':target_id,'title':manual['title'],'url':manual['url'],'notes':'Lesson notes','targetUpdated':target['updated']})
   target=next(row for row in api('') if row['id']==target_id);assert target['lessonUrl']==manual['url'] and target['notes']=='Keep target notes'
   linked=next(row for row in lessons() if row.get('songId')==target_id);original=next(row for row in api('') if row['id']==sid)
   payload={'lessonId':target_id,'sourceSongId':target_id,'songId':sid,'title':original['title'],'url':linked['url'],'notes':target['notes'],'sourceUpdated':linked['updated'],'targetUpdated':original['updated']}
   try:mapping({**payload,'targetUpdated':'2000-01-01T00:00:00Z'});raise AssertionError('stale mapping accepted')
   except urllib.error.HTTPError as error:assert error.code==400
   assert next(row for row in api('') if row['id']==target_id)['lessonUrl']==linked['url']
   mapping(payload);after=api('');assert next(row for row in after if row['id']==target_id)['lessonUrl']=='';original=next(row for row in after if row['id']==sid);assert original['lessonUrl']==linked['url'] and original['notes']=='Worker notes'
   mapping({'lessonId':sid,'sourceSongId':sid,'songId':None,'title':original['title'],'url':original['lessonUrl'],'notes':original['notes'],'sourceUpdated':original['updated']})
   assert all(not row['lessonUrl'] for row in api('')) and len(lessons())>=1

   print('PASS song lesson projection, existing URL deduplication, song-name updates; real API: library list, notes/link edits, conflict protection, image upload/read/delete, invalid image cleanup, Mac image conversion and cue preservation.')
  finally:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait()
