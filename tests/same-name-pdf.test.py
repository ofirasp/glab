"""Run after dotnet build. Uses an isolated library and the app's real PDF endpoints."""
import concurrent.futures
import json
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

repo = Path(__file__).resolve().parents[1]
dotnet = os.environ.get('GPL_TEST_DOTNET', 'dotnet')
dll = repo / 'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'


def pdf(text, pages=1):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>']
    kids = ' '.join(f'{3 + index * 2} 0 R' for index in range(pages))
    objects.append(f'<< /Type /Pages /Count {pages} /Kids [{kids}] >>'.encode())
    for index in range(pages):
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents {4 + index * 2} 0 R >>'.encode())
        stream = ('% ' + text + '\n').replace('\\n', '\n').encode()
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'endstream')
    data = b'%PDF-1.4\n'
    offsets = [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{index} 0 obj\n'.encode() + value + b'\nendobj\n'
    xref = len(data)
    data += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    data += b''.join(f'{offset:010} 00000 n \n'.encode() for offset in offsets[1:])
    data += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return data


with tempfile.TemporaryDirectory(prefix='glab-same-name-') as temporary:
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

            old_pdf, new_pdf = pdf('old', 2), pdf('new', 2)
            song = call('/pdf?name=Song.pdf', 'POST', old_pdf)
            identity = song['id']
            cue = {'time': 0, 'page': 2, 'position': .4, 'pageAnchor': .3, 'zoom': 1.5, 'label': 'Verse'}
            call('/' + identity, 'PUT', {'title': 'Renamed song', 'notes': 'Keep these notes', 'cues': [cue]})
            audio = folder / 'tone.mp3'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=110:duration=2',
                            '-y', str(audio)], check=True)
            call('/' + identity + '/audio?name=Original.mp3', 'POST', audio.read_bytes())
            backing = folder / 'backing.mp3'
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(audio), '-c', 'copy', '-metadata',
                            'comment=GPL_SOURCE_SHA256=' + hashlib.sha256(audio.read_bytes()).hexdigest(),
                            '-y', str(backing)], check=True)
            call('/' + identity + '/audio?name=Backing.mp3&variant=backing', 'POST', backing.read_bytes())
            # Attaching a new original resets cues, so restore them after audio import.
            call('/' + identity, 'PUT', {'cues': [cue]})
            current = call()[0]
            rhythm = {'bpm': 120, 'meter': '4/4', 'firstDownbeat': 0}
            call('/' + identity + '/rhythm', 'PUT', {'audioVersion': current['audioVersion'], 'rhythm': rhythm})
            replacement = call('/pdf?name=SONG.PDF', 'POST', new_pdf)
            assert replacement['id'] == identity and len(call()) == 1
            assert replacement['cues'] == [cue] and replacement['notes'] == 'Keep these notes'
            assert replacement['title'] == 'Renamed song'
            assert replacement['hasAudio'] and replacement['hasBacking'] and replacement['rhythm']['bpm'] == 120
            assert call('/' + identity + '/pdf') == new_pdf
            print('PASS same filename replaces PDF and preserves ID, cues, notes, title, audio, backing and rhythm')
            call('/pdf?name=Song.pdf', 'POST', b'%PDF-invalid', expected=400)
            assert call('/' + identity + '/pdf') == new_pdf and call()[0]['cues'] == [cue]
            print('PASS invalid replacement leaves the previous song intact')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda text: call('/pdf?name=Song.pdf', 'POST', pdf(text, 2)), ['retry one', 'retry two']))
            assert all(item['id'] == identity for item in results) and len(call()) == 1
            assert call()[0]['cues'] == [cue]
            print('PASS concurrent same-name imports retain one song and its cues')
            smaller = call('/pdf?name=Song.pdf', 'POST', pdf('one page'))
            assert len(smaller['cues']) == 1 and smaller['cues'][0]['time'] == 0 and smaller['cues'][0]['page'] == 1
            print('PASS fewer pages retain cues with valid page numbers')
            metadata = folder / 'library' / identity.replace('-', '') / 'song.json'
            legacy = json.loads(metadata.read_text())
            legacy['pdfStem'] = ''
            legacy['title'] = 'Song'
            metadata.write_text(json.dumps(legacy))
            assert call('/pdf?name=Song.pdf', 'POST', pdf('legacy'))['id'] == identity
            print('PASS legacy songs match by title when the original filename is absent')
            duplicate = dict(json.loads(metadata.read_text()), id=str(uuid.uuid4()))
            duplicate_folder = folder / 'library' / duplicate['id'].replace('-', '')
            duplicate_folder.mkdir()
            (duplicate_folder / 'song.json').write_text(json.dumps(duplicate))
            call('/pdf?name=Song.pdf', 'POST', pdf('ambiguous'), expected=400)
            assert len(call()) == 2
            print('PASS ambiguous existing duplicates require selection instead of overwriting an arbitrary entry')
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
