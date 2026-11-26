"""Test manual slash-chord corrections independently of PDF extraction/audio analysis."""
import json,os,socket,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='glab-slash-timeline-') as temporary:
 root=Path(temporary);sid='11111111-1111-1111-1111-111111111111';folder=root/'library'/sid.replace('-','');folder.mkdir(parents=True)
 previous={'shift':0,'changes':[{'time':0,'name':'G'},{'time':4,'name':'D7'}],'corrected':False}
 cue={'time':1,'page':1,'position':.4,'zoom':1,'label':'Keep Follow'}
 saved={'id':sid,'title':'Song','pages':1,'pdfFile':'original.pdf','audioFile':'original.mp3','duration':12,'notes':'Keep notes','cues':[cue],'chordAnalysis':previous}
 (folder/'song.json').write_text(json.dumps(saved));(folder/'original.pdf').write_bytes(b'%PDF-fixture')
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 base=f'http://127.0.0.1:{port}/api/song-library'
 env=dict(os.environ,GUITAR_SONG_LIBRARY=str(root/'library'),GUITAR_RECORDINGS_ROOT=str(root/'recordings'),ASPNETCORE_ENVIRONMENT='Development')
 with (root/'server.log').open('w') as log:
  process=subprocess.Popen([os.environ['GPL_TEST_DOTNET'],str(repo/'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'),'--urls',f'http://127.0.0.1:{port}'],cwd=repo/'src/GuitarPracticeLab.Web',env=env,stdout=log,stderr=log)
  try:
   def call(path='',body=None,expected=200):
    request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method='PUT' if body is not None else 'GET',headers={'Content-Type':'application/json'})
    try:response=urllib.request.urlopen(request,timeout=15)
    except urllib.error.HTTPError as error:response=error
    with response:result=json.load(response);assert response.status==expected,(response.status,result);return result
   for i in range(100):
    try:call();break
    except urllib.error.URLError:time.sleep(.1)
   path='/'+sid+'/pdf-sync?key=guitar-auto-pdf-'+sid+'-123'
   assert call(path) is None
   state={'anchors':{'0':'page-1-chord-2'},'skips':{'2':True},'repeats':[{'source':0,'time':4}],'direction':'rtl','mode':'auto'}
   assert call(path,{'state':state})['saved']
   assert call(path)==state
   state['anchors']['1']='page-2-chord-1'
   call(path,{'state':state});assert call(path)==state
   latest=call()[0];assert latest['notes']=='Keep notes' and latest['cues'][0]['label']=='Keep Follow'
   call(path,{'state':[]},expected=400);assert call(path)==state
   print('PASS shared PDF sync persists anchors, skips, repeated bars, direction and mode; independent reads agree; invalid updates preserve saved state and manual cues.')
  finally:
   process.terminate()
   try:process.wait(timeout=5)
   except subprocess.TimeoutExpired:process.kill();process.wait()
