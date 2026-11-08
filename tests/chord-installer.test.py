"""Exercise the real installer with isolated files and mocked Pi commands."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
manifest=json.loads((repo/'tools/chord-update/manifest.json').read_text())
# Before-images are provided from the original source commit by the test caller.
baseline=os.environ.get('GPL_TEST_BASELINE','b53790d')
for mode in ('success','previous-update','preserved-local','build-failure','startup-failure','desktop-failure','local-change'):
 with tempfile.TemporaryDirectory(prefix='glab-installer-') as temp:
  root=Path(temp);lab=root/'lab';project=lab/'GuitarPracticeLab.Web';published=lab/'published';bins=root/'bin'
  project.mkdir(parents=True);published.mkdir();bins.mkdir()
  autostart=root/'autostart';autostart.mkdir();entry=autostart/'guitar-lab-lessons.desktop';entry.write_text('previous desktop entry')
  (project/'GuitarPracticeLab.Web.csproj').write_text('<Project/>')
  (published/'previous.txt').write_text('previous running app')
  originals={}
  for name,hashes in manifest.items():
   if mode=='previous-update' or hashes['before'] is not None:
    version='b15eb82' if mode=='previous-update' else baseline
    copy=subprocess.run(['git','-C',str(repo),'show',version+':src/GuitarPracticeLab.Web/'+name],capture_output=True)
    if copy.returncode and hashes['before'] is None:continue
    assert copy.returncode==0,(name,copy.stderr)
    value=copy.stdout
    if mode!='previous-update':assert hashlib.sha256(value).hexdigest()==hashes['before']
    f=project/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(value);originals[name]=value
  preserved_name = 'Desktop/lesson-browser.py'
  if mode == 'preserved-local':
   source = (repo/'src/GuitarPracticeLab.Web'/preserved_name).read_bytes()
   local = source.replace(b",'--no-first-run'", b",'--password-store=basic','--no-first-run'", 1)
   target = project/preserved_name
   target.parent.mkdir(parents=True, exist_ok=True)
   target.write_bytes(local)
  if mode=='local-change':
   (project/'SongLibrary.cs').write_text('// custom Pi edit');originals['SongLibrary.cs']=b'// custom Pi edit'
  commands={'sudo':'exec "$@"','apt-get':'exit 0','systemctl':'exit 0','sleep':'exit 0',
   'curl':'[ "$GPL_TEST_MODE" != startup-failure ]',
   'dotnet':'''[ "$GPL_TEST_MODE" != build-failure ] || exit 1
while [ "$#" -gt 0 ]; do
 if [ "$1" = -o ]; then mkdir -p "$2"; echo new > "$2/new.txt"; break; fi
 shift
done'''}
  for name,body in commands.items():
   f=bins/name;f.write_text('#!/bin/bash\n'+body+'\n');f.chmod(0o755)
  if mode=='desktop-failure':
   blocked=root/'blocked';blocked.write_text('not a directory')
  env=os.environ.copy();env.update(GPL_LAB_ROOT=str(lab),GPL_AUTOSTART_DIR=str(blocked if mode=='desktop-failure' else autostart),DOTNET_ROOT=str(bins),GPL_TEST_MODE=mode,PATH=str(bins)+':'+env['PATH'])
  result=subprocess.run(['bash',str(repo/'tools/chord-update/install.sh')],env=env,capture_output=True,text=True)
  assert (result.returncode==0)==(mode in ('success','previous-update','preserved-local')),(mode,result.stdout,result.stderr)
  if mode in ('success','previous-update','preserved-local'):
   assert (published/'new.txt').exists()
   assert 'Desktop/lesson-browser.py' in entry.read_text()
   for name,hashes in manifest.items():
    contents = (project/name).read_bytes()
    if mode == 'preserved-local' and name == preserved_name:
     assert contents == local
    else:
     assert hashlib.sha256(contents).hexdigest() == hashes['after']
  else:
   assert (published/'previous.txt').read_text()=='previous running app'
   assert entry.read_text()=='previous desktop entry'
   for name,hashes in manifest.items():
    if name in originals:assert (project/name).read_bytes()==originals[name],(mode,name)
    else:assert not (project/name).exists(),(mode,name)
  print('PASS',mode)
