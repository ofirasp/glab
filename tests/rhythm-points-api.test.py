"""Run after dotnet build. Checks separate regular/simple chord analyses in an isolated library."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

repo = Path(__file__).resolve().parents[1]
dotnet = os.environ.get('GPL_TEST_DOTNET', 'dotnet')
dll = repo / 'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'


with tempfile.TemporaryDirectory(prefix='glab-simple-analysis-') as temporary:
    folder = Path(temporary)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}/api/song-library'
    environment = dict(os.environ, GUITAR_SONG_LIBRARY=str(folder / 'library'),
                       GUITAR_RECORDINGS_ROOT=str(folder / 'recordings'),
                       ASPNETCORE_ENVIRONMENT='Development')
    with (folder / 'server.log').open('w+') as log:
        process = subprocess.Popen([dotnet, str(dll), '--urls', f'http://127.0.0.1:{port}'],
                                   cwd=repo / 'src/GuitarPracticeLab.Web', env=environment,
                                   stdout=log, stderr=log)
        try:
            def call(path='', method='GET', data=None, expected=200):
                if isinstance(data, dict):
                    data = json.dumps(data).encode()
                request = urllib.request.Request(base + path, data=data, method=method,
                                                 headers={'Content-Type': 'application/json'})
                try:
                    response = urllib.request.urlopen(request, timeout=30)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    result = response.read()
                    assert response.status == expected, (response.status, result)
                    return json.loads(result) if result and not path.endswith('/pdf') else result

            for attempt in range(200):
                try:
                    call()
                    break
                except urllib.error.URLError:
                    if process.poll() is not None:
                        raise RuntimeError('Test server exited')
                    time.sleep(.1)
            else:
                raise RuntimeError('Test server did not start')

            import fitz
            document=fitz.open();page=document.new_page();page.insert_text((50,50),'G')
            song=call('/pdf?name=Rhythm.pdf','POST',document.tobytes());document.close()
            identity=song['id']
            audio=folder/'tone.mp3'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=110:duration=2','-y',str(audio)],check=True)
            song=call('/'+identity+'/audio?name=Original.mp3','POST',audio.read_bytes())
            cue={'time':.3,'page':1,'position':.4,'zoom':1,'label':'Recorded Follow'}
            cue=call('/'+identity,'PUT',{'cues':[cue]})['cues'][0]
            rhythm={'bpm':100,'meter':'4/4','firstDownbeat':0,'points':[{'time':.5,'bpm':110,'meter':'3/4'},{'time':1.2,'bpm':120,'meter':'6/8'}]}
            def save(value,expected=200):
                return call('/'+identity+'/rhythm','PUT',{'audioVersion':song['audioVersion'],'rhythm':value},expected)
            saved=save(rhythm)
            assert saved['rhythm']['points']==rhythm['points'] and saved['cues']==[cue]
            assert call()[0]['rhythm']['points']==rhythm['points']
            print('PASS numbered rhythm points persist independently of Follow cues')
            save({'bpm':90,'meter':'4/4','firstDownbeat':0})
            assert call()[0]['rhythm']['points']==rhythm['points']
            print('PASS older clients cannot accidentally erase saved rhythm points')
            for points in [[{'time':3,'bpm':110,'meter':'4/4'}],list(reversed(rhythm['points'])),[rhythm['points'][0]]*2,[{'time':.5,'bpm':10,'meter':'4/4'}]]:
                save({**rhythm,'points':points},400)
            assert call()[0]['rhythm']['points']==rhythm['points']
            print('PASS invalid, duplicate and unsorted points are rejected without data loss')
            save({**rhythm,'points':[]})
            assert call()[0]['rhythm']['points']==[]
            assert call()[0]['cues']==[cue]
            print('PASS points can be removed without changing recorded scrolling')
        except Exception:
            log.flush();print((folder/'server.log').read_text());raise
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
