#!/usr/bin/env bash
# Update only chord-feature files in the existing Pi project. Keep library data outside publishing.
set -euo pipefail
bundle="$(cd "$(dirname "$0")" && pwd)"
lab="${GPL_LAB_ROOT:-$HOME/GuitarPracticeLab}"
project="$lab/GuitarPracticeLab.Web"
backup="$lab/backups/chord-shapes-$(date +%Y%m%d-%H%M%S)-$$"
stage="$lab/chord-publish-$$"
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export PATH="$DOTNET_ROOT:$PATH"
test -f "$project/GuitarPracticeLab.Web.csproj" || { echo 'Cannot find the Pi app source.'; exit 1; }
command -v dotnet >/dev/null || { echo 'The .NET SDK is not available.'; exit 1; }
systemctl cat guitar-practice-lab >/dev/null
test -d "$lab/published" || { echo "Cannot find the existing published app."; exit 1; }
# Repository checkout or extracted update bundle.
if test -d "$bundle/payload"; then payload="$bundle/payload"; else payload="$bundle/../../src/GuitarPracticeLab.Web"; fi
export CHORD_AUTOSTART="${GPL_AUTOSTART_DIR:-$HOME/.config/autostart}/guitar-lab-lessons.desktop"
export CHORD_PROJECT="$project" CHORD_PAYLOAD="$payload" CHORD_MANIFEST="$bundle/manifest.json" CHORD_BACKUP="$backup"
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
p,s,m=(Path(os.environ[k]) for k in ('CHORD_PROJECT','CHORD_PAYLOAD','CHORD_MANIFEST'))
for name,allowed in json.loads(m.read_text()).items():
 source=s/name
 if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest()!=allowed['after']:raise SystemExit('Incomplete update: '+name)
 target=p/name
 value=hashlib.sha256(target.read_bytes()).hexdigest() if target.exists() else None
 if value not in [allowed['before'],allowed['after'],*allowed.get('compatible',[]),*allowed.get('preserve',[])]:raise SystemExit('Local changes found in '+name+'. Please sync the Pi source before installing. No app files changed.')
print('Source compatibility checked.')
PY
sudo apt-get install -y poppler-utils alsa-utils swayidle wlopm
mkdir -p "$backup/source" "$stage"
python3 - <<'PY'
import json,os,shutil
from pathlib import Path
p,s,m,b=(Path(os.environ[k]) for k in ('CHORD_PROJECT','CHORD_PAYLOAD','CHORD_MANIFEST','CHORD_BACKUP'))
for name in json.loads(m.read_text()):
 target=p/name
 if target.exists():
  copy=b/'source'/name;copy.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,copy)
PY
python3 - <<'DESKTOP_BACKUP'
import os,shutil
from pathlib import Path
path=Path(os.environ['CHORD_AUTOSTART']);backup=Path(os.environ['CHORD_BACKUP'])/'lesson-browser.desktop'
if path.exists():shutil.copy2(path,backup)
DESKTOP_BACKUP
desktop_changed=0
source_changed=0
published_swapped=0
service_stopped=0
restore() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo 'Update failed; restoring the previous source and deployment.'
    if [ "$desktop_changed" = 1 ]; then
      python3 - <<'DESKTOP_RESTORE'
import os,shutil
from pathlib import Path
path=Path(os.environ['CHORD_AUTOSTART']);backup=Path(os.environ['CHORD_BACKUP'])/'lesson-browser.desktop'
if backup.exists():path.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backup,path)
elif path.exists():path.unlink()
DESKTOP_RESTORE
    fi
    if [ "$source_changed" = 1 ]; then
      python3 - <<'PY'
import json,os,shutil
from pathlib import Path
p,m,b=(Path(os.environ[k]) for k in ('CHORD_PROJECT','CHORD_MANIFEST','CHORD_BACKUP'))
for name in json.loads(m.read_text()):
 old=b/'source'/name;target=p/name
 if old.exists():shutil.copy2(old,target)
 elif target.exists():target.unlink()
PY
    fi
    if [ "$published_swapped" = 1 ]; then
      sudo systemctl stop guitar-practice-lab || true
      if [ -d "$lab/published" ]; then mv "$lab/published" "$backup/failed-published"; fi
      if [ -d "$backup/published" ]; then mv "$backup/published" "$lab/published"; fi
    fi
    if [ "$service_stopped" = 1 ]; then sudo systemctl start guitar-practice-lab || true; fi
    echo "Backup: $backup"
  fi
  exit "$code"
}
trap restore EXIT
source_changed=1
python3 - <<'PYCODE'
import hashlib,json,os,shutil
from pathlib import Path
p,s,m=(Path(os.environ[k]) for k in ('CHORD_PROJECT','CHORD_PAYLOAD','CHORD_MANIFEST'))
for name,allowed in json.loads(m.read_text()).items():
 target=p/name
 if allowed.get('preserve') and target.exists():
  if hashlib.sha256(target.read_bytes()).hexdigest() in allowed['preserve']:continue
 target.parent.mkdir(parents=True,exist_ok=True)
 shutil.copy2(s/name,target)
PYCODE
# Build before touching the running service.
dotnet publish "$project" -c Release -o "$stage"
sudo systemctl stop guitar-practice-lab
service_stopped=1
mv "$lab/published" "$backup/published"
published_swapped=1
mv "$stage" "$lab/published"
sudo systemctl start guitar-practice-lab
ready=0
for attempt in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:5080/api/song-library >/dev/null && curl -fsS --max-time 3 http://127.0.0.1:5080/chord-viewer.js >/dev/null; then ready=1;break;fi
  sleep 1
done
[ "$ready" = 1 ] || { echo 'App did not become ready.'; exit 1; }
desktop_changed=1
python3 - <<'DESKTOP_INSTALL'
import os
from pathlib import Path
path=Path(os.environ['CHORD_AUTOSTART']);script=Path(os.environ['CHORD_PROJECT'])/'Desktop/desktop-session.py'
def quoted(value):return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$')+'"'
path.parent.mkdir(parents=True,exist_ok=True)
temporary=path.with_suffix('.tmp')
temporary.write_text('[Desktop Entry]\nType=Application\nName=Guitar Practice Lab desktop controls\nExec=/usr/bin/python3 '+quoted(script)+'\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\n')
temporary.replace(path)
DESKTOP_INSTALL
echo "Installed. Backup: $backup"
echo 'Restart the Pi once to activate desktop controls and the lesson browser.'
echo 'Close and reopen the app browser. Practice → 1 Minute Changes uses the Pi microphone.'
echo 'Choose your guitar tuning in the popup. Standard tuning is supported; alternate-tuning diagrams stay hidden.'
