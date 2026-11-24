import json,os,subprocess,tempfile,socket,time,urllib.request,urllib.error,uuid,shutil
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='glab-match-') as tmp:
 root=Path(tmp);library=root/'library';library.mkdir();recordings=root/'recordings';recordings.mkdir()
 original=recordings/'Artist_Song-original.mp3'
 subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=196:duration=2','-y',str(original)],check=True)
 import hashlib
 digest=hashlib.sha256(original.read_bytes()).hexdigest()
 subprocess.run(['ffmpeg','-v','error','-i',str(original),'-c','copy','-metadata','comment=GPL_SOURCE_SHA256='+digest,'-y',str(recordings/'Artist_Song-backing.mp3')],check=True)
 def song(title):
  sid=uuid.uuid4();folder=library/sid.hex;folder.mkdir();(folder/'original.pdf').write_bytes(b'%PDF-1.4\n');(folder/'song.json').write_text(json.dumps({'id':str(sid),'title':title,'pdfStem':title,'pages':1,'cues':[]}));return str(sid),folder
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 env=dict(os.environ,GUITAR_SONG_LIBRARY=str(library),GUITAR_RECORDINGS_ROOT=str(recordings),ASPNETCORE_ENVIRONMENT='Development')
 with (root/'server.log').open('w+') as log:
  proc=subprocess.Popen([os.environ['GPL_TEST_DOTNET'],str(repo/'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'),'--urls',f'http://127.0.0.1:{port}'],env=env,cwd=repo/'src/GuitarPracticeLab.Web',stdout=log,stderr=log)
  try:
   base=f'http://127.0.0.1:{port}/api/song-library'
   for _ in range(150):
    try:urllib.request.urlopen(base,timeout=1).close();break
    except Exception:time.sleep(.1)
   def match(sid,expected=200):
    req=urllib.request.Request(base+'/'+sid+'/match-audio',data=b'',method='POST')
    try:r=urllib.request.urlopen(req,timeout=20)
    except urllib.error.HTTPError as e:r=e
    with r:data=r.read();assert r.status==expected,(r.status,data);return json.loads(data)
   sid,folder=song('Artist - Song - Chords');result=match(sid);assert result['matched'] and result['song']['hasAudio'] and result['song']['hasBacking'];assert result['song']['audioName']==original.name
   count=len(list(folder.glob('audio-*')));assert not match(sid)['matched'];assert len(list(folder.glob('audio-*')))==count
   shutil.copy(original,recordings/'Artist-Song.mp3');other,_=song('Artist Song - Chords');assert 'Several' in match(other)['message']
   missing,_=song('Missing song');assert not match(missing)['song']['hasAudio']
   (recordings/'Unsafe-original.mp3').symlink_to(original);unsafe,_=song('Unsafe - Chords');match(unsafe,400)
   (recordings/'Invalid.mp3').write_text('not an mp3');invalid,folder=song('Invalid - Chords');match(invalid,400);assert not list(folder.glob('audio-*'))
   print('PASS real MP3 auto-match, backing validation, normalized names, existing audio, ambiguous/missing files, symlinks and invalid-file cleanup')
  finally:proc.terminate();proc.wait(timeout=10)
