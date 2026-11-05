#!/bin/bash
set -eu
lab="$HOME/GuitarPracticeLab"
mkdir -p "$lab/logs"
exec 9>"$lab/kiosk.lock"
flock -n 9 || exit 0
exec >>"$lab/logs/kiosk-startup.log" 2>&1
echo "Kiosk starting: $(date -Is)"
browser=$(command -v chromium || command -v chromium-browser)
profile="$HOME/.config/guitar-lab-browser"
# Do not launch a second copy into an already open profile.
if pgrep -f "[c]hromium.*--user-data-dir=$profile" >/dev/null; then exit 0; fi
until curl -fsS --max-time 3 http://127.0.0.1:5080/ >/dev/null &&
      curl -fsS --max-time 3 http://127.0.0.1:5080/practice.html >/dev/null; do
    sleep 2
done
# Let the desktop compositor finish starting on this Pi.
sleep 5
mkdir -p "$profile"
rm -f "$profile/DevToolsActivePort"
"$browser" --user-data-dir="$profile" --password-store=basic \
    --no-first-run --no-default-browser-check --disable-gpu \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 \
    --kiosk http://127.0.0.1:5080/ &
browser_pid=$!
python3 "$lab/kiosk-startup-watch.py" "$profile" "$browser_pid" &
watch_pid=$!
trap 'kill "$watch_pid" 2>/dev/null || true' EXIT
wait "$browser_pid" || true
