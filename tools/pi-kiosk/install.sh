#!/bin/bash
set -euo pipefail
bundle="$(cd "$(dirname "$0")" && pwd)"
lab="$HOME/GuitarPracticeLab"
test -f "$lab/start-kiosk.sh" || { echo 'Cannot find the kiosk launcher.'; exit 1; }
command -v python3 >/dev/null
command -v flock >/dev/null
command -v curl >/dev/null
backup="$lab/backups/kiosk-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$backup" "$lab/logs"
cp -p "$lab/start-kiosk.sh" "$backup/start-kiosk.sh"
if test -f "$lab/kiosk-startup-watch.py"; then
    cp -p "$lab/kiosk-startup-watch.py" "$backup/"
fi
bash -n "$bundle/start-kiosk.sh"
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$bundle/kiosk-startup-watch.py"
cp "$bundle/kiosk-startup-watch.py" "$lab/kiosk-startup-watch.py"
cp "$bundle/start-kiosk.sh" "$lab/start-kiosk.sh"
chmod +x "$lab/start-kiosk.sh"
echo "Installed. Backup: $backup"
echo 'Reboot to activate the new launcher.'
