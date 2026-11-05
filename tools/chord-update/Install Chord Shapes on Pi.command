#!/bin/bash
set -euo pipefail
umask 077
bundle="$(cd "$(dirname "$0")" && pwd)"
archive="$bundle/GuitarLab-Chord-Update.zip"
if [ ! -f "$archive" ]; then archive="$bundle/../GuitarLab-Chord-Update.zip"; fi
test -f "$archive" || { echo 'Keep this command beside GuitarLab-Chord-Update.zip.'; read -r -p 'Press Return to close.'; exit 1; }
target="${GPL_PI_TARGET:-ofiras@glab.local}"
[[ "$target" =~ ^[A-Za-z0-9_.@:-]+$ ]] || { echo 'Invalid Pi SSH destination.'; exit 1; }
temporary=$(mktemp -d /tmp/glab-chord-ssh.XXXXXX)
socket="$temporary/ssh"
cleanup() { ssh -S "$socket" -O exit "$target" >/dev/null 2>&1 || true; rmdir "$temporary" 2>/dev/null || true; }
trap cleanup EXIT
remote="GuitarPracticeLab/updates/chords-$(date +%Y%m%d-%H%M%S)-$$"
echo 'Connect to the Pi. Enter its SSH password here when asked.'
ssh -M -S "$socket" -o ControlPersist=120 -o ServerAliveInterval=30 -fnN "$target"
ssh -S "$socket" "$target" "mkdir -p '$remote'"
scp -o "ControlPath=$socket" "$archive" "$target:$remote/update.zip"
ssh -t -S "$socket" "$target" "cd '$remote' && unzip -q update.zip && bash GuitarLab-Chord-Update/install.sh"
echo 'Done. Close and reopen the Pi app, open Songs and tap Chords.'
read -r -p 'Press Return to close.'
