"""Tests use temporary local files and a simulated Pi; no YouTube downloads or real SSH."""
import contextlib,hashlib,importlib.util,io,json,os,shutil,socket,subprocess,sys,tempfile,unittest.mock as mock
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'tools/mac-song-studio'
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
worker=load('studio_worker',ROOT/'worker.py');remote=load('studio_remote',ROOT/'remote_import.py')
with tempfile.TemporaryDirectory(prefix='studio-test-') as temporary:
 home=Path(temporary);pdf=home/'sheet.pdf';pdf.write_bytes(b'%PDF-1.4\nfixture');source=home/'source.mp3';wav=home/'stem.wav'
 subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=196:duration=1','-y',str(source)],check=True)
 subprocess.run(['ffmpeg','-v','error','-i',str(source),'-y',str(wav)],check=True)
 config={'name':'Test Song','url':'https://www.youtube.com/watch?v=J9JOut9yh5g','pdf':str(pdf),'target':'ofiras@glab.local','password':'private-test-password','capo':3,'import':True,'analyze':True}
 for change in [{'name':'../escape'},{'target':'-oProxyCommand=bad'},{'url':'https://example.com/music'},{'capo':13}]:
  try:worker.validate({**config,**change});raise AssertionError('accepted invalid input')
  except ValueError:pass
 requests=[]
 def api(path,method,body,data):
  requests.append((path,method,body))
  if path.startswith('/pdf?'):assert data==pdf.read_bytes();return{'id':'song','audioVersion':'','chordAnalysis':None,'rhythm':None}
  if '/audio?' in path:return{'id':'song','hasBacking':True,'audioVersion':'new','chordAnalysis':None,'rhythm':None}
  if path.endswith('analyze-chords'):assert body['shift']==3;return{}
  if path.endswith('rhythm/analyze'):return{'estimate':{'bpm':96,'meter':None,'firstDownbeat':0},'audioVersion':'new'}
  if path.endswith('/rhythm'):assert body['rhythm']['meter']=='4/4';return{}
  raise AssertionError(path)
 class FakeSSH:
  def __init__(self,target,password):assert target=='ofiras@glab.local' and password==config['password']
  def connect(self):pass
  def close(self):pass
  def send(self,files,job):
   folder=home/'GuitarPracticeLab/incoming'/job;folder.mkdir(parents=True)
   for file,name in zip(files,['source.pdf','source-original.mp3','source-backing.mp3']):shutil.copyfile(file,folder/name)
  def remote(self,c):return remote.execute(c,home,api)
 helper=worker.load_helper();helper.prepare_runtime=lambda tools,env:Path(sys.executable);helper.download=lambda *args:source
 real_run=subprocess.run
 def fake_demucs(command,*args,**kwargs):
  if '-m' in command and 'demucs' in command:
   out=Path(command[command.index('--out')+1])/'htdemucs'/source.stem;out.mkdir(parents=True);shutil.copyfile(wav,out/'no_vocals.wav');return subprocess.CompletedProcess(command,0)
  return real_run(command,*args,**kwargs)
 capture=io.StringIO()
 with mock.patch.object(worker,'SSH',FakeSSH),mock.patch.object(worker,'load_helper',return_value=helper),mock.patch.object(Path,'home',return_value=home),mock.patch.dict(os.environ,{'GPL_TOOLS_DIR':str(home/'tools')}),mock.patch.object(worker.subprocess,'run',side_effect=fake_demucs),contextlib.redirect_stdout(capture):worker.run(dict(config))
 text=capture.getvalue();assert config['password'] not in text
 events=[json.loads(line[10:]) for line in text.splitlines() if line.startswith('GPL_EVENT ')];assert events[-1]['type']=='complete' and events[-1]['imported']
 recordings=home/'GuitarPracticeLab/recordings';assert sorted(f.name for f in recordings.iterdir())==['Test Song-backing.mp3','Test Song-original.mp3','Test Song.pdf']
 tag=helper.audio_info(recordings/'Test Song-backing.mp3')['format']['tags']['comment'];assert tag=='GPL_SOURCE_SHA256='+helper.digest(recordings/'Test Song-original.mp3')
 assert len(requests)==5
 # A different file must not replace the existing song unless enabled; backups retain it.
 job='a'*32;incoming=home/'GuitarPracticeLab/incoming'/job;incoming.mkdir(parents=True)
 changed=[b'%PDF-new',source.read_bytes(),(recordings/'Test Song-backing.mp3').read_bytes()]
 for name,data in zip(['source.pdf','source-original.mp3','source-backing.mp3'],changed):(incoming/name).write_bytes(data)
 publish={**config,'job':job,'hashes':[hashlib.sha256(d).hexdigest() for d in changed],'import':False}
 try:remote.execute(publish,home);raise AssertionError('replaced silently')
 except ValueError:pass
 assert (recordings/'Test Song.pdf').read_bytes()==pdf.read_bytes()
 remote.execute({**publish,'replace':True},home);assert (recordings/'.song-studio-backups'/job/'Test Song.pdf').read_bytes()==pdf.read_bytes()
 # Import failure keeps delivered files and returns a clear warning.
 job='b'*32;incoming=home/'GuitarPracticeLab/incoming'/job;incoming.mkdir(parents=True)
 for name,data in zip(['source.pdf','source-original.mp3','source-backing.mp3'],changed):(incoming/name).write_bytes(data)
 def unavailable(*args):raise ValueError('App unavailable')
 result=remote.execute({**publish,'job':job,'import':True},home,unavailable);assert result['transferred'] and not result['imported'] and 'App unavailable' in result['warnings'][0]
 # Exercise a real controlling terminal with a fragmented password prompt.
 secret="spaces ' and \u05e9"
 expected=hashlib.sha256(secret.encode()).hexdigest()
 program="""import os,sys,time,hashlib
assert os.isatty(0)
fd=os.open('/dev/tty',os.O_RDWR)
os.write(fd,b"ofiras@glab.local's Pass")
time.sleep(.03)
os.write(fd,b'word: ')
value=b''
while not value.endswith(b'\\n'):value+=os.read(fd,1)
assert hashlib.sha256(value.rstrip(b'\\n')).hexdigest()==sys.argv[1]
print('AUTH_OK')
"""
 code,text,answered=worker.terminal_auth([sys.executable,'-c',program,expected],secret)
 assert code==0 and answered==1 and 'AUTH_OK' in text and secret not in text
 connection=worker.SSH('ofiras@glab.local',secret)
 with mock.patch.object(worker.subprocess,'run',return_value=subprocess.CompletedProcess([],1)),mock.patch.object(worker,'terminal_auth',return_value=(255,'Permission denied',1)) as terminal:
  try:connection.connect();raise AssertionError('accepted rejection')
  except ValueError as error:assert 'rejected' in str(error) and secret not in str(error)
  assert secret not in ' '.join(terminal.call_args.args[0]);assert terminal.call_args.args[1]==secret
 with mock.patch.object(worker.subprocess,'run',return_value=subprocess.CompletedProcess([],0)):connection.close()
print('PASS complete local pipeline, exact filenames, validated backing identity, import/capo/rhythm, backups, error recovery, input validation and private interactive terminal password channel')
