#!/usr/bin/env python3
"""Song Studio processing bridge. Request, including password, arrives on stdin."""
import base64,errno,fcntl,hashlib,importlib.util,json,os,pty,re,select,shlex,shutil,signal,subprocess,sys,tempfile,termios,time,unicodedata,uuid
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent

def event(kind,**values):print('GPL_EVENT '+json.dumps({'type':kind,**values}),flush=True)
def stage(name,message):event('progress',stage=name,message=message)
def load_helper():
 path=HERE/'make-backing.py'
 if not path.exists():path=HERE.parent/'mac-backing/make-backing.py'
 spec=importlib.util.spec_from_file_location('backing_helper',path);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper);return helper

def validate(config):
 from_remote=importlib.util.spec_from_file_location('remote_song_import',HERE/'remote_import.py');module=importlib.util.module_from_spec(from_remote);from_remote.loader.exec_module(module)
 target=config.get('target','ofiras@glab.local').strip()
 if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9][A-Za-z0-9.-]*',target):raise ValueError('Enter the Pi login as username@hostname, for example ofiras@glab.local.')
 config['target']=target
 if config.get('action') in ('test','list'):return config
 if config.get('action')=='edit':
  if not re.fullmatch(r'[a-fA-F0-9-]{32,36}',str(config.get('songId',''))):raise ValueError('Select a song from the Pi library.')
  if not isinstance(config.get('notes',''),str) or len(config.get('notes',''))>10000:raise ValueError('Notes are limited to 10,000 characters.')
  if len(config.get('lessonUrl',''))>2048:raise ValueError('Lesson link is too long.')
  removals=config.get('removeImages',[])
  if not isinstance(removals,list) or len(removals)>30 or any(not isinstance(value,str) or not re.fullmatch(r'[a-fA-F0-9-]{32,36}',value) for value in removals):raise ValueError('Invalid image removal list.')
  images=config.get('images',[])
  if not isinstance(images,list) or len(images)>30:raise ValueError('Choose up to 30 images.')
  for image in images:
   file=Path(image)
   if not file.is_file() or file.suffix.lower() not in ('.png','.jpg','.jpeg','.heic','.webp') or file.stat().st_size>30*1024*1024:raise ValueError('Choose PNG, JPEG, HEIC or WebP files up to 30 MB each.')
  return config
 config['name']=module.safe_name(unicodedata.normalize('NFC',config.get('name','')))
 pdf=Path(config.get('pdf','')).expanduser()
 if not pdf.is_file() or pdf.suffix.lower()!='.pdf' or pdf.stat().st_size>20*1024*1024:raise ValueError('Choose a PDF no larger than 20 MB.')
 with pdf.open('rb') as stream:
  if stream.read(5)!=b'%PDF-':raise ValueError('The selected file is not a PDF.')
 config['pdf']=str(pdf.resolve());config['url']=load_helper().is_youtube(config.get('url',''))
 if not config['url']:raise ValueError('Enter a YouTube or YouTube Music URL.')
 capo=config.get('capo',0)
 if not isinstance(capo,int) or isinstance(capo,bool) or not 0<=capo<=12:raise ValueError('Capo must be from 0 to 12.')
 return config

def terminal_auth(command,password,env=None,timeout=45):
 """Give OpenSSH a private controlling terminal, as in the working Terminal helper."""
 master,slave=pty.openpty();attributes=termios.tcgetattr(slave);attributes[3]&=~termios.ECHO;termios.tcsetattr(slave,termios.TCSANOW,attributes)
 def child_terminal():
  os.setsid();fcntl.ioctl(slave,termios.TIOCSCTTY,0)
 process=None;output=bytearray();pending='';answered=0;deadline=time.monotonic()+timeout
 try:
  process=subprocess.Popen(command,stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=child_terminal,close_fds=True);os.close(slave);slave=-1
  while True:
   if time.monotonic()>deadline:raise ValueError('SSH connection timed out. Check the Pi address and network.')
   readable,_,_=select.select([master],[],[],.15)
   if readable:
    try:data=os.read(master,4096)
    except OSError as error:
     if error.errno==errno.EIO:data=b''
     else:raise
    if data:
     output.extend(data);pending=(pending+data.decode('utf-8','replace'))[-8192:]
     if re.search(r'(?:password|passphrase)[^:\r\n]{0,160}:\s*$',pending,re.I):
      if not password:raise ValueError('Enter the Pi password in the app, or use a working SSH key.')
      if answered:raise ValueError('The Pi rejected the password. Check the login and the password entered in the app.')
      os.write(master,password.encode('utf-8')+b'\n');answered+=1;pending=''
    elif process.poll() is not None:break
   if process.poll() is not None:
    # Drain any final SSH error without ever logging terminal input.
    while select.select([master],[],[],0)[0]:
     try:data=os.read(master,4096)
     except OSError:break
     if not data:break
     output.extend(data)
    break
  text=bytes(output).decode('utf-8','replace')
  if password:text=text.replace(password,'[hidden]')
  return process.wait(),text,answered
 finally:
  if process is not None and process.poll() is None:
   try:os.killpg(process.pid,signal.SIGTERM)
   except ProcessLookupError:pass
   process.wait(timeout=5)
  if slave!=-1:os.close(slave)
  os.close(master)

class SSH:
 def __init__(self,target,password):
  self.target=target;self.password=password;self.temporary=tempfile.TemporaryDirectory(prefix='glab-ssh-');self.folder=Path(self.temporary.name);self.folder.chmod(0o700);self.socket=str(self.folder/'control')
 def connect(self):
  if subprocess.run(['/usr/bin/ssh','-S',self.socket,'-O','check',self.target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return
  command=['/usr/bin/ssh','-M','-S',self.socket,'-fN','-o','ControlPersist=600','-o','ConnectTimeout=12','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','-o','StrictHostKeyChecking=accept-new','-o','NumberOfPasswordPrompts=1']
  if self.password:command+=['-o','PreferredAuthentications=password,keyboard-interactive','-o','PasswordAuthentication=yes']
  else:command+=['-o','BatchMode=yes']
  command.append(self.target);env=os.environ.copy();env.pop('SSH_ASKPASS',None);env['SSH_ASKPASS_REQUIRE']='never'
  code,text,answered=terminal_auth(command,self.password,env)
  if code:
   if 'Permission denied' in text:
    detail='The Pi rejected the entered password.' if answered else 'SSH login failed. Enter the Pi password, or leave it blank only when an SSH key works.'
    raise ValueError(detail+' Your existing password does not need to be changed. '+text.strip())
   raise ValueError('Could not connect to the Pi. '+text.strip())
 def remote(self,config):
  self.connect();code=(HERE/'remote_import.py').read_text()
  command='python3 -c '+shlex.quote(code)
  process=subprocess.run(['/usr/bin/ssh','-S',self.socket,'-o','ConnectTimeout=12',self.target,command],input=json.dumps(config),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:result=json.loads(process.stdout)
  except Exception:raise ValueError('The Pi could not run the import helper. '+process.stderr.strip())
  if process.returncode or result.get('error'):raise ValueError(result.get('error') or process.stderr.strip())
  return result
 def send(self,files,job):
  self.connect();directory='GuitarPracticeLab/incoming/'+job
  subprocess.run(['/usr/bin/ssh','-S',self.socket,self.target,'mkdir -p '+directory],check=True)
  for source,name in zip(files,['source.pdf','source-original.mp3','source-backing.mp3']):
   subprocess.run(['/usr/bin/scp','-o','ControlPath='+self.socket,'-o','ConnectTimeout=12',str(source),self.target+':'+directory+'/'+name],check=True)
 def close(self):
  subprocess.run(['/usr/bin/ssh','-S',self.socket,'-O','exit',self.target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  self.password='';self.temporary.cleanup()

def run(config):
 config=validate(config);password=config.pop('password','');connection=SSH(config['target'],password);password=''
 try:
  stage('connect','Connecting to '+config['target']+'…');connection.connect()
  if config.get('action')=='test':
   result=connection.remote({'action':'test'});event('complete',message=result['message']);return
  if config.get('action')=='list':
   result=connection.remote({'action':'list'});event('library',songs=result['songs']);event('complete',message='Song library loaded.');return
  if config.get('action')=='edit':
   result=connection.remote({key:config[key] for key in ('action','songId','notes','lessonUrl','expectedUpdated') if key in config})
   event('song',song=result['song'])
   for image_id in dict.fromkeys(config.get('removeImages',[])):
    stage('send','Removing saved image…')
    result=connection.remote({'action':'image-delete','songId':config['songId'],'imageId':image_id})
    event('song',song=result['song'],removed=image_id)
   with tempfile.TemporaryDirectory(prefix='song-studio-images-') as temporary:
    for index,image in enumerate(config.get('images',[])):
     stage('send','Uploading image '+str(index+1)+' of '+str(len(config['images']))+'…')
     encoded=Path(temporary)/'image.jpg'
     conversion=subprocess.run(['/usr/bin/sips','-s','format','jpeg','-Z','2400',image,'--out',str(encoded)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
     if conversion.returncode or not encoded.is_file():raise ValueError('Could not convert '+Path(image).name+'. Notes were saved; choose the remaining images and try again.')
     if encoded.stat().st_size>8*1024*1024:raise ValueError('Converted image exceeds 8 MB. Notes were saved; use a smaller image.')
     result=connection.remote({'action':'image','songId':config['songId'],'name':Path(image).stem+'.jpg','data':base64.b64encode(encoded.read_bytes()).decode()})
     event('song',song=result['song'],uploaded=image)
   event('complete',message='Saved on the Pi. Notes, lesson link and images are ready.');return
  check=connection.remote({'action':'check','name':config['name'],'import':config.get('import',True),'pdfHash':hashlib.sha256(Path(config['pdf']).read_bytes()).hexdigest()})
  if (check['existing'] or check.get('libraryExisting')) and not config.get('replace'):raise ValueError('A song or files with this name already exist on the Pi. Choose another name, or enable replacement to keep backups.')
  helper=load_helper()
  if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):raise ValueError('FFmpeg is missing on this Mac. Install FFmpeg before creating backing tracks.')
  tools=Path(os.environ.get('GPL_TOOLS_DIR',str(Path.home()/'Documents/Codex/GuitarPracticeLabTools')));tools.mkdir(parents=True,exist_ok=True)
  env=os.environ.copy();env.pop('PYTHONPATH',None);env['TORCH_HOME']=str(tools/'vocal-models');env['OMP_NUM_THREADS']='4'
  if Path('/etc/ssl/cert.pem').exists():env['SSL_CERT_FILE']=env['REQUESTS_CA_BUNDLE']='/etc/ssl/cert.pem'
  stage('download','Preparing audio tools…');python=helper.prepare_runtime(tools,env)
  output=Path.home()/'Documents/Codex/GuitarPracticeLabAudio';output.mkdir(parents=True,exist_ok=True)
  stage('download','Downloading the original recording from YouTube…');source=helper.download(config['url'],python,output,env)
  info=helper.audio_info(source)
  if source.stat().st_size>100*1024*1024 or not 0<float(info['format']['duration'])<=7200:raise ValueError('Choose an MP3 no larger than 100 MB and no longer than two hours.')
  stage('separate','Removing vocals on this Mac. This can take several minutes…')
  with tempfile.TemporaryDirectory(prefix='song-studio-',dir=tools) as temp:
   temporary=Path(temp);subprocess.run([str(python),'-m','demucs','--two-stems','vocals','-n','htdemucs','-d','cpu','--shifts','1','--segment','7','--overlap','0.25','-j','1','--out',str(temporary),str(source)],env=env,check=True)
   stem=temporary/'htdemucs'/source.stem/'no_vocals.wav'
   if not stem.is_file():raise ValueError('The backing track could not be created.')
   pair=temporary/'pair';pair.mkdir();original,backing=helper.encode_pair(source,stem,pair)
   folder=output/config['name'];n=2
   while folder.exists():folder=output/(config['name']+' ('+str(n)+')');n+=1
   folder.mkdir();names=[config['name']+'.pdf',config['name']+'-original.mp3',config['name']+'-backing.mp3'];files=[]
   for src,name in zip([Path(config['pdf']),original,backing],names):destination=folder/name;shutil.copy2(src,destination);files.append(destination)
  event('output',path=str(folder));stage('send','Sending the PDF, original and backing to the Pi…');job=uuid.uuid4().hex;connection.send(files,job)
  stage('import','Importing and analyzing on the Pi…' if config.get('import',True) else 'Saving the files on the Pi…')
  hashes=[hashlib.sha256(f.read_bytes()).hexdigest() for f in files]
  result=connection.remote({**config,'action':'publish','job':job,'hashes':hashes})
  warnings=result.get('warnings',[]);message='Imported into the Pi song library. Open Library on the Pi to see it.' if result.get('imported') else 'Files sent to the Pi recordings folder.'
  event('complete',message=message,warnings=warnings,output=str(folder),imported=result.get('imported',False))
 finally:connection.close()

if __name__=='__main__':
 try:
  os.setsid()
 except OSError:pass
 signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
 try:run(json.load(sys.stdin))
 except KeyboardInterrupt:event('cancelled',message='Cancelled. Completed Mac files are kept.');sys.exit(130)
 except Exception as e:event('error',message=str(e));sys.exit(1)
