"""Archive/restore Guitar Lab data and its browser profiles. Run remotely over SSH."""
import io,json,os,shutil,sys,tarfile,tempfile,time
from pathlib import Path,PurePosixPath
ROOTS=['GuitarPracticeLab','.config/guitar-lab-browser','.config/guitar-lab-lessons','.config/chromium','.config/wireplumber','.local/state/wireplumber']
SKIP={'bin','obj','published','backups','updates','logs','incoming','node_modules','__pycache__','Cache','Code Cache','GPUCache','ShaderCache','GrShaderCache','DawnCache','Crash Reports','BrowserMetrics'}
TRANSIENT={'request.json','agent.lock','status.json','status.tmp','SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort'}
def allowed(name):
 p=PurePosixPath(name)
 return not p.is_absolute() and '..' not in p.parts and any(name==r or name.startswith(r+'/') for r in ROOTS)
def selected(home):
 for root in ROOTS:
  base=home/root
  if not base.exists():continue
  for directory,dirs,files in os.walk(base,followlinks=False):
   dirs[:]=[d for d in dirs if d not in SKIP and not (Path(directory)/d).is_symlink()]
   for name in files:
    file=Path(directory)/name
    if name not in TRANSIENT and file.is_file() and not file.is_symlink():yield file

def backup(home,stream):
 with tarfile.open(fileobj=stream,mode='w|gz') as archive:
  info=json.dumps({'format':'guitar-lab-backup','version':1,'created':time.time(),'roots':ROOTS}).encode();member=tarfile.TarInfo('GuitarLab-backup.json');member.size=len(info);archive.addfile(member,io.BytesIO(info))
  for file in selected(home):archive.add(file,arcname=file.relative_to(home).as_posix(),recursive=False)

def restore(home,source):
 stamp=time.strftime('%Y%m%d-%H%M%S')+'-'+str(os.getpid());safety=home/'GuitarPracticeLab/backups'/('before-restore-'+stamp)
 with tempfile.TemporaryDirectory(prefix='glab-restore-',dir=home) as temporary:
  stage=Path(temporary)
  with tarfile.open(source,'r:gz') as archive:
   members=archive.getmembers();meta=archive.extractfile('GuitarLab-backup.json');manifest=json.load(meta)
   if manifest.get('format')!='guitar-lab-backup' or manifest.get('version')!=1:raise ValueError('Unsupported backup format.')
   names=set()
   for member in members:
    if member.name=='GuitarLab-backup.json':continue
    if not member.isfile() or not allowed(member.name) or member.name in names:raise ValueError('Unsafe or duplicate backup path.')
    names.add(member.name);destination=stage/member.name;destination.parent.mkdir(parents=True,exist_ok=True)
    with archive.extractfile(member) as src,destination.open('wb') as dst:shutil.copyfileobj(src,dst)
    destination.chmod(member.mode & 0o777)
  # Validate every destination before changing anything; never follow a symlink.
  for name in names:
   target=home/name
   for parent in [target,*target.parents]:
    if parent==home:break
    if parent.is_symlink():raise ValueError('Restore destination contains a symbolic link: '+name)
   if target.exists() and not target.is_file():raise ValueError('Restore destination is not a file: '+name)
  safety.mkdir(parents=True,exist_ok=False)
  applied=[]
  try:
   for name in sorted(names):
    target=home/name;old=safety/name
    if target.exists():old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,old)
    applied.append((target,old));target.parent.mkdir(parents=True,exist_ok=True);os.replace(stage/name,target)
  except BaseException:
   for target,old in reversed(applied):
    if old.exists():shutil.copy2(old,target)
    else:target.unlink(missing_ok=True)
   raise
 return {'files':len(names),'safety':str(safety)}
if __name__=='__main__':
 home=Path.home()
 if sys.argv[1]=='backup':backup(home,sys.stdout.buffer)
 elif sys.argv[1]=='restore':print(json.dumps(restore(home,sys.argv[2])))
