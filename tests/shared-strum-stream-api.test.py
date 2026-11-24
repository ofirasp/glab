"""Verify the chord stream supplies fresh, non-overlapping PCM and capture timestamps."""
import base64,json,os,socket,struct,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
dotnet=os.environ['GPL_TEST_DOTNET']
with tempfile.TemporaryDirectory(prefix='glab-pcm-stream-') as temp:
    root=Path(temp);fake=root/'arecord'
    fake.write_text('#!'+sys.executable+'\nimport sys,struct\nsys.stdout.buffer.write(b"".join(struct.pack("<h",(i%101-50)*3) for i in range(16000)))\n')
    fake.chmod(0o755)
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    env=dict(os.environ,PATH=str(root)+os.pathsep+os.environ['PATH'],GUITAR_SONG_LIBRARY=str(root/'library'),GUITAR_RECORDINGS_ROOT=str(root/'recordings'),GUITAR_CHORD_PRACTICE=str(root/'practice'),GUITAR_LOOPS_ROOT=str(root/'loops'),GPL_LAB_ROOT=str(root/'lab'),ASPNETCORE_ENVIRONMENT='Development')
    base=f'http://127.0.0.1:{port}'
    with (root/'server.log').open('w') as log:
        process=subprocess.Popen([dotnet,str(repo/'src/GuitarPracticeLab.Web/bin/Debug/net10.0/GuitarPracticeLab.Web.dll'),'--urls',base],cwd=repo/'src/GuitarPracticeLab.Web',env=env,stdout=log,stderr=log)
        try:
            for i in range(100):
                try:
                    with urllib.request.urlopen(base+'/api/song-library',timeout=1):break
                except Exception:time.sleep(.1)
            body=json.dumps({'device':'default','names':['C','G'],'shift':0,'includeAudio':True}).encode()
            request=urllib.request.Request(base+'/api/chord-practice/listen-chords',data=body,headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=15) as response:rows=[json.loads(response.readline()) for _ in range(3)]
            chunks=[base64.b64decode(row['audioPcm16']) for row in rows]
            assert list(map(len,chunks))==[8192,4096,4096]
            assert b''.join(chunks)==b''.join(struct.pack('<h',(i%101-50)*3) for i in range(8192))
            assert [row['capturedSeconds'] for row in rows]==[.256,.384,.512]
            assert all(row['captureAgeSeconds']>=0 for row in rows)
            print('PASS actual server PCM stream: no overlap or missing samples, exact capture clock, and processing-age metadata')
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
