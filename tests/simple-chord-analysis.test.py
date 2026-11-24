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
            def sheet(chord):
                document = fitz.open()
                page = document.new_page()
                page.insert_text((50, 50), chord, fontsize=18)
                result = document.tobytes()
                document.close()
                return result
            recordings = folder / 'recordings'
            recordings.mkdir(exist_ok=True)
            simple = recordings / 'Song-simple.pdf'
            simple.write_bytes(sheet('Am'))
            entry = call('/pdf?name=Song.pdf', 'POST', sheet('G'))
            identity = entry['id']
            audio = folder / 'tone.mp3'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            'aevalsrc=0.15*sin(2*PI*196*t)+0.15*sin(2*PI*246.94*t)+0.15*sin(2*PI*293.66*t):s=16000:d=2',
                            '-y', str(audio)], check=True)
            call('/' + identity + '/audio?name=Original.mp3', 'POST', audio.read_bytes())
            call('/' + identity + '/simple')
            regular = call('/' + identity + '/analyze-chords', 'POST', {'shift': 0})
            simplified = call('/' + identity + '/analyze-chords', 'POST', {'shift': 1, 'variant': 'simple'})
            saved = call()[0]
            assert saved['chordAnalysis'] == regular
            assert saved['simpleChordAnalysis'] == simplified
            assert regular['shift'] == 0 and simplified['shift'] == 1
            assert all(item['name'] in (None, 'G') for item in regular['changes'])
            assert all(item['name'] in (None, 'Am') for item in simplified['changes'])
            print('PASS displayed PDF supplies chord candidates and analyses persist separately')
            call('/' + identity + '/analyze-chords', 'POST', {'shift': 0, 'variant': 'invalid'}, expected=400)
            assert call()[0]['chordAnalysis'] == regular
            print('PASS invalid PDF variant cannot overwrite the saved analysis')
            simple.write_bytes(sheet('C'))
            assert call()[0]['simpleChordAnalysis'] is None
            assert call()[0]['chordAnalysis'] == regular
            print('PASS changing the simple PDF invalidates only its analysis')
        except Exception:
            log.flush()
            print((folder / 'server.log').read_text())
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
