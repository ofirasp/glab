Guitar Practice Lab: kiosk startup recovery

Install on the Pi with:
  bash ~/GuitarPracticeLab/updates/kiosk-startup-fix/install.sh
Then reboot.

The launcher waits for the home page and dashboard, lets the desktop settle,
and disables Chromium GPU acceleration. This is a workaround for a suspected
rendering problem, not a confirmed diagnosis of the Pi's intermittent white screen.

A local-only Chromium debugging endpoint on an automatically selected port lets
an included Python helper check startup. Empty or failed startup pages are retried
up to twice. The helper exits once content loads, or after the bounded startup
window. It does not reload an established practice session. It cannot detect all
rendering failures if Chromium reports a healthy document.

The Desktop button still closes the browser. Existing desktop and autostart
entries continue using the same start-kiosk.sh path. No app rebuild is needed.

Logs: ~/GuitarPracticeLab/logs/kiosk-startup.log
Backups: ~/GuitarPracticeLab/backups/kiosk-<timestamp>-<process>/
To undo, copy that backup's start-kiosk.sh over ~/GuitarPracticeLab/start-kiosk.sh
and reboot. Songs, recordings and app source are not changed.

Chromium flag reference:
https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc
