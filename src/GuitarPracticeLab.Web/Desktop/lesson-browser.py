#!/usr/bin/env python3
"""Runs in the Pi desktop session, never the web-service session.
A dedicated Chromium profile keeps its windows separate from the practice kiosk.
"""
import base64,fcntl,hashlib,json,logging,os,shutil,signal,subprocess,time
from pathlib import Path
from urllib.parse import urlparse

class Browser:
 def __init__(self,root=None,launcher=subprocess.Popen):
  lab=Path(os.environ.get('GPL_LAB_ROOT',str(Path.home()/'GuitarPracticeLab')))
  self.root=Path(root or os.environ.get('GUITAR_LESSON_BROWSER',str(lab/'lesson-browser')))
  self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
  self.root.chmod(0o700)
  self.profile=Path.home()/'.config/guitar-lab-lessons'
  self.executable=shutil.which('chromium') or shutil.which('chromium-browser')
  self.process=None;self.launcher=launcher;self.error='';self.seen=None
  self.app_url=os.environ.get('GPL_APP_URL','http://127.0.0.1:5080').rstrip('/')
  self.url=self.app_url+'/lesson-return.html'
  self.extension=self.root/'capture-extension';self.prepare_extension()
 def prepare_extension(self):
  source=Path(__file__).with_name('LessonCapture')
  self.extension.mkdir(exist_ok=True,mode=0o700)
  for name in ('manifest.json','worker.js'):shutil.copy2(source/name,self.extension/name)
  (self.extension/'config.js').write_text('const GUITAR_LESSON_CONFIG='+json.dumps({'appUrl':self.app_url})+';\n')
  manifest=json.loads((self.extension/'manifest.json').read_text())
  digest=hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32]
  self.extension_id=''.join(chr(ord('a')+int(c,16)) for c in digest)
 def running(self):return self.process is not None and self.process.poll() is None
 def close(self):
  if self.running():
   self.process.terminate()
   try:self.process.wait(timeout=5)
   except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
  self.process=None
 def handle(self,command):
  if command.get('id')==self.seen or abs(time.time()-command.get('created',0))>30:return
  self.seen=command.get('id')
  if command.get('action')=='close':self.close();self.error='';return
  if command.get('action')!='open':return
  url=command.get('url','');parsed=urlparse(url)
  if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or any(ord(c)<32 for c in url):raise ValueError('Invalid lesson link.')
  if not self.executable:raise RuntimeError('Chromium is not installed.')
  base=[self.executable,'--user-data-dir='+str(self.profile),'--no-first-run','--no-default-browser-check','--load-extension='+str(self.extension)]
  if self.running():self.launcher(base+['--new-tab',url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:self.process=self.launcher(base+['--start-maximized','--new-window',self.url,url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.error=''
 def status(self):
  target=self.root/'status.json';temp=self.root/'status.tmp'
  temp.write_text(json.dumps({'heartbeat':time.time(),'available':bool(self.executable),'running':self.running(),'error':self.error,'captureId':self.extension_id}));temp.replace(target)
 def run(self):
  lock=(self.root/'agent.lock').open('a')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  stopping=False
  def stop(*_):
   nonlocal stopping
   stopping=True
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  try:
   while not stopping:
    try:
     request=self.root/'request.json'
     if request.exists():self.handle(json.loads(request.read_text()))
    except Exception as error:self.error=str(error)[:200]
    self.status();time.sleep(.4)
  finally:
   self.close()
   try:(self.root/'status.json').unlink()
   except FileNotFoundError:pass
if __name__=='__main__':Browser().run()
