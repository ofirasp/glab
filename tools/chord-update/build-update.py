#!/usr/bin/env python3
"""Build a self-contained Mac installer plus an optional standalone ZIP."""
import argparse,base64,hashlib,io,json,zipfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
repo=Path(__file__).resolve().parents[2];tools=Path(__file__).resolve().parent
manifest=json.loads((tools/'manifest.json').read_text());buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
 for name,hashes in manifest.items():
  file=repo/'src/GuitarPracticeLab.Web'/name
  if hashlib.sha256(file.read_bytes()).hexdigest()!=hashes['after']:raise SystemExit('Update manifest is stale: '+name)
  archive.writestr('GuitarLab-Chord-Update/payload/'+name,file.read_bytes())
 for name in ('install.sh','manifest.json','README.md'):archive.writestr('GuitarLab-Chord-Update/'+name,(tools/name).read_bytes())
script='''#!/bin/bash
set -euo pipefail
umask 077
temporary=$(mktemp -d /tmp/glab-update.XXXXXX)
socket="$temporary/ssh"
archive="$temporary/update.zip"
target="${GPL_PI_TARGET:-ofiras@glab.local}"
[[ "$target" =~ ^[A-Za-z0-9_.@:-]+$ ]] || { echo 'Invalid Pi SSH destination.'; exit 1; }
cleanup() { ssh -S "$socket" -O exit "$target" >/dev/null 2>&1 || true; rm -f "$archive"; rmdir "$temporary" 2>/dev/null || true; }
trap cleanup EXIT
python3 - "$0" "$archive" <<'PAYLOAD_PY'
import base64,sys
from pathlib import Path
encoded=Path(sys.argv[1]).read_text().split('\\n__GPL_PAYLOAD__\\n',1)[1]
Path(sys.argv[2]).write_bytes(base64.b64decode(encoded))
PAYLOAD_PY
remote="GuitarPracticeLab/updates/app-$(date +%Y%m%d-%H%M%S)-$$"
echo 'Guitar Practice Lab update: Lessons, saved links and guitar practice exercises.'
echo 'Enter the Pi SSH password when asked. Sudo may ask separately.'
ssh -M -S "$socket" -o ControlPersist=120 -o ServerAliveInterval=30 -fnN "$target"
ssh -S "$socket" "$target" "mkdir -p '$remote'"
scp -o "ControlPath=$socket" "$archive" "$target:$remote/update.zip"
ssh -t -S "$socket" "$target" "cd '$remote' && unzip -q update.zip && bash GuitarLab-Chord-Update/install.sh"
echo 'Done. Restart the Pi once to activate the Lessons browser helper.'
read -r -p 'Press Return to close.'
exit 0
__GPL_PAYLOAD__
'''
args.output.mkdir(parents=True,exist_ok=True)
(args.output/'GuitarLab-Update.zip').write_bytes(buffer.getvalue())
command=args.output/'Update Guitar Practice Lab.command';command.write_text(script+base64.encodebytes(buffer.getvalue()).decode());command.chmod(0o755)
with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive:assert archive.testzip() is None
print(command.resolve())
