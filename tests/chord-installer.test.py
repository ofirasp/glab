"""Exercise the real installer with isolated files and mocked Pi commands."""
import hashlib,json,os,subprocess,tempfile
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
manifest=json.loads((repo/'tools/chord-update/manifest.json').read_text())
# Before-images are provided from the original source commit by the test caller.
baseline=os.environ.get('GPL_TEST_BASELINE','b53790d')
for mode in ('success','build-failure','startup-failure','local-change'):
 with tempfile.TemporaryDirectory(prefix='glab-installer-') as temp:
  root=Path(temp);lab=root/'lab';project=lab/'GuitarPracticeLab.Web';published=lab/'published';bins=root/'bin'
  project.mkdir(parents=True);published.mkdir();bins.mkdir()
  (project/'GuitarPracticeLab.Web.csproj').write_text('<Project/>')
  (published/'previous.txt').write_text('previous running app')
  originals={}
  for name,hashes in manifest.items():
   if hashes['before'] is not None:
    value=subprocess.check_output(['git','-C',str(repo),'show',baseline+':src/GuitarPracticeLab.Web/'+name]);assert hashlib.sha256(value).hexdigest()==hashes['before']
    f=project/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(value);originals[name]=value
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
  env=os.environ.copy();env.update(GPL_LAB_ROOT=str(lab),DOTNET_ROOT=str(bins),GPL_TEST_MODE=mode,PATH=str(bins)+':'+env['PATH'])
  result=subprocess.run(['bash',str(repo/'tools/chord-update/install.sh')],env=env,capture_output=True,text=True)
  assert (result.returncode==0)==(mode=='success'),(mode,result.stdout,result.stderr)
  if mode=='success':
   assert (published/'new.txt').exists()
   for name,hashes in manifest.items():assert hashlib.sha256((project/name).read_bytes()).hexdigest()==hashes['after']
  else:
   assert (published/'previous.txt').read_text()=='previous running app'
   for name,hashes in manifest.items():
    if name in originals:assert (project/name).read_bytes()==originals[name],(mode,name)
    else:assert not (project/name).exists(),(mode,name)
  print('PASS',mode)
