#!/usr/bin/env python3
"""Runs on the Pi over SSH. Receives configuration on stdin, never credentials."""
import hashlib,json,os,re,shutil,sys,urllib.parse,urllib.request
from pathlib import Path

def digest(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def safe_name(value):
 value=value.strip()
 if not value or value in ('.','..') or value.startswith('.') or len(value.encode('utf-8'))>180 or re.search(r'[\x00-\x1f\x7f/\\:<>"|?*]',value):raise ValueError('Choose a song name without slashes or special filename characters.')
 return value

def execute(config,home=None,api=None):
 home=Path(home or Path.home());root=home/'GuitarPracticeLab';recordings=root/'recordings'
 if config.get('action')=='test':return {'connected':True,'message':'Connected to the Pi.','python':sys.version.split()[0]}
 def call(path,method='POST',body=None,data=None):
  if api:return api(path,method,body,data)
  headers={}
  if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
  req=urllib.request.Request('http://127.0.0.1:5080/api/song-library'+path,data=data,headers=headers,method=method)
  try:
   with urllib.request.urlopen(req,timeout=1800) as response:return json.load(response)
  except urllib.error.HTTPError as e:
   try:message=(lambda detail:detail.get('message') or detail.get('detail') or str(e))(json.load(e))
   except Exception:message=str(e)
   raise ValueError(message) from e
 action=config.get('action')
 if action=='list':return {'songs':call('',method='GET')}
 if action in ('edit','image','image-delete'):
  sid=str(config.get('songId',''))
  if not re.fullmatch(r'[a-fA-F0-9-]{32,36}',sid):raise ValueError('Select a valid song.')
  if action=='image-delete':
   image_id=str(config.get('imageId',''))
   if not re.fullmatch(r'[a-fA-F0-9-]{32,36}',image_id):raise ValueError('Select a valid image.')
   return {'song':call('/'+sid+'/images/'+image_id,method='DELETE')}
  if action=='edit':
   settings={key:config[key] for key in ('notes','lessonUrl','expectedUpdated') if key in config}
   return {'song':call('/'+sid,method='PUT',body=settings)}
  import base64
  image=base64.b64decode(config.get('data',''),validate=True)
  if len(image)>8*1024*1024:raise ValueError('Images must be no larger than 8 MB.')
  return {'song':call('/'+sid+'/images?'+urllib.parse.urlencode({'name':str(config.get('name','Image'))[:160]}),data=image)}
 name=safe_name(config['name']);names=[name+'.pdf',name+'-original.mp3',name+'-backing.mp3']
 existing_songs=[]
 library=root/'song-library'
 if library.is_dir():
  for metadata in library.glob('*/song.json'):
   try:
    saved=json.loads(metadata.read_text());stem=(saved.get('pdfStem') or saved.get('title') or '').strip()
    pdf_hash=config.get('pdfHash') or (config.get('hashes') or [''])[0]
    if stem.casefold()==name.casefold() or (pdf_hash and saved.get('pdfHash','').casefold()==pdf_hash.casefold()):existing_songs.append((metadata,saved))
   except (OSError,ValueError):pass
 if config.get('action')=='check':return {'existing':[n for n in names if (recordings/n).exists()],'libraryExisting':bool(existing_songs) if config.get('import',True) else False}

 job=config['job']
 if not re.fullmatch(r'[a-f0-9]{32}',job):raise ValueError('Invalid transfer job.')
 incoming=root/'incoming'/job;recordings.mkdir(parents=True,exist_ok=True)
 sources=[incoming/n for n in ('source.pdf','source-original.mp3','source-backing.mp3')]
 hashes=config['hashes']
 for source,expected in zip(sources,hashes):
  if not source.is_file() or source.is_symlink() or digest(source)!=expected:raise ValueError('An uploaded file failed verification. Please send it again.')
 differences=[n for n,h in zip(names,hashes) if (recordings/n).exists() and digest(recordings/n)!=h]
 if (differences or (existing_songs and config.get('import',True))) and not config.get('replace'):raise ValueError('Files already exist with different contents. Enable replacement or choose a different song name.')
 backup=recordings/'.song-studio-backups'/job
 if config.get('import',True) and existing_songs:
  backup.mkdir(parents=True,exist_ok=True)
  for metadata,saved in existing_songs:
   shutil.copy2(metadata,backup/('song-'+metadata.parent.name+'.json'))
   old_pdf=metadata.parent/Path(saved.get('pdfFile','original.pdf')).name
   if old_pdf.is_file():shutil.copy2(old_pdf,backup/('sheet-'+metadata.parent.name+'.pdf'))
 for source,n in zip(sources,names):
  target=recordings/n
  if target.is_symlink():raise ValueError('A target filename is a symbolic link. Choose another name.')
 for source,n in zip(sources,names):
  target=recordings/n
  if n in differences:backup.mkdir(parents=True,exist_ok=True);shutil.copy2(target,backup/n)
  os.replace(source,target)
 shutil.rmtree(incoming,ignore_errors=True)
 result={'transferred':True,'imported':False,'files':names,'warnings':[]}
 if not config.get('import',True):return result

 try:
  pdf=recordings/names[0]
  song=call('/pdf?'+urllib.parse.urlencode({'name':names[0]}),data=pdf.read_bytes())
  sid=song['id'];had_audio=bool(song.get('hasAudio'));old_audio_version=song.get('audioVersion');original=recordings/names[1]
  # Explicitly attach the chosen original; the Pi validates and attaches its backing.
  song=call('/'+sid+'/audio?'+urllib.parse.urlencode({'name':names[1]}),data=original.read_bytes())
  if not song.get('hasBacking') or old_audio_version==song.get('audioVersion'):
   song=call('/'+sid+'/audio?'+urllib.parse.urlencode({'variant':'backing','name':names[2]}),data=(recordings/names[2]).read_bytes())
  result.update(imported=True,songId=sid)
  if had_audio and old_audio_version!=song.get('audioVersion'):result['warnings'].append('The original recording changed. The Pi reset its old timing/analysis; a metadata backup was kept.')
  if config.get('analyze',True):
   if isinstance(song.get('chordAnalysis'),dict) and song['chordAnalysis'].get('corrected'):result['warnings'].append('Kept the existing manual chord corrections.')
   else:
    try:call('/'+sid+'/analyze-chords',body={'shift':config.get('capo',0),'variant':''})
    except Exception as e:result['warnings'].append('Chord analysis: '+str(e))
   if not song.get('rhythm'):
    try:
     estimate=call('/'+sid+'/rhythm/analyze');rhythm=estimate['estimate'];rhythm['meter']=rhythm.get('meter') or '4/4'
     call('/'+sid+'/rhythm',method='PUT',body={'audioVersion':estimate['audioVersion'],'rhythm':rhythm})
    except Exception as e:result['warnings'].append('Rhythm analysis: '+str(e))
   else:result['warnings'].append('Kept the saved rhythm and bar-start settings.')
 except Exception as e:result['warnings'].append('Files were sent, but import needs attention: '+str(e))
 return result

if __name__=='__main__':
 try:print(json.dumps(execute(json.load(sys.stdin))))
 except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
