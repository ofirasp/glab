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
            def sheet(name):
                document=fitz.open();page=document.new_page();page.insert_text((50,50),name);data=document.tobytes();document.close();return data
            standard=sheet('G C');simple=sheet('Am D')
            (folder/'recordings').mkdir(exist_ok=True)
            (folder/'recordings'/'Song-simple.pdf').write_bytes(simple)
            song=call('/pdf?name=Song.pdf','POST',standard);identity=song['id']
            audio=folder/'tone.mp3'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=196:duration=2','-y',str(audio)],check=True)
            song=call('/'+identity+'/audio?name=Original.mp3','POST',audio.read_bytes())
            cue={'time':.2,'page':1,'position':.4,'zoom':1,'label':'Recorded Follow'}
            saved=call('/'+identity,'PUT',{'cues':[cue],'notes':'Keep these notes'})
            cues=saved['cues'];call('/'+identity+'/simple')
            original=call('/'+identity+'/analyze-chords','POST',{'shift':0})
            edited={'shift':0,'changes':[{'time':0,'name':'G'},{'time':.8,'name':'D'}]}
            def edit(previous,analysis,variant='',version=None,expected=200):
                return call('/'+identity+'/chord-timeline','PUT',{'audioVersion':version or song['audioVersion'],'variant':variant,'previous':previous,'analysis':analysis},expected)
            result=edit(original,edited)
            assert result['corrected'] and result['changes']==edited['changes']
            assert call()[0]['chordAnalysis']==result
            assert call()[0]['cues']==cues and call()[0]['notes']=='Keep these notes'
            assert call('/'+identity+'/pdf')==standard
            print('PASS manual corrections persist and leave PDF, notes and Follow cues intact')
            edit(original,edited,expected=409)
            edit(result,edited,version='different-audio',expected=409)
            for invalid in [dict(edited,shift=1),dict(edited,changes=list(reversed(edited['changes']))),dict(edited,changes=[{'time':3,'name':'G'}]),dict(edited,changes=[{'time':0,'name':'not-a-chord'}])]:
                edit(result,invalid,expected=400)
            assert call()[0]['chordAnalysis']==result
            print('PASS stale analyses, wrong audio and invalid boundaries cannot overwrite saved corrections')
            simplified=call('/'+identity+'/analyze-chords','POST',{'shift':0,'variant':'simple'})
            simple_result=edit(simplified,{'shift':0,'changes':[{'time':0,'name':'Am'},{'time':1,'name':'D'}]},'simple')
            assert call()[0]['simpleChordAnalysis']==simple_result and call()[0]['chordAnalysis']==result
            print('PASS regular and simple PDF corrections remain separate')
            wave=call('/'+identity+'/waveform?start=0&end=1')
            assert len(wave['bins'])==160 and max(wave['bins'])>0 and all(0<=value<=1 for value in wave['bins'])
            call('/'+identity+'/waveform?start=0&end=30',expected=400)
            print('PASS real MP3 waveform supplies bounded peaks and rejects invalid ranges')
            slash=edit(result,{'shift':0,'changes':[{'time':0,'name':'Fmaj7/G'},{'time':1,'name':'C/G'}]})
            assert slash['changes'][0]['name']=='Fmaj7/G' and call()[0]['chordAnalysis']==slash
            assert call()[0]['cues']==cues and call('/'+identity+'/pdf')==standard
            edit(slash,{'shift':0,'changes':[{'time':0,'name':'Funknown/G'}]},expected=400)
            assert call()[0]['chordAnalysis']==slash
            print('PASS slash chords save exactly, preserve sync inputs, and invalid qualities remain rejected')

        except Exception:
            log.flush();print((folder/'server.log').read_text());raise
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
