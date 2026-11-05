#!/bin/bash
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
folder="$(cd "$(dirname "$0")" && pwd)"
python_bin="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"
if [ ! -x "$python_bin" ]; then python_bin="$(command -v python3)"; fi
result=0
/usr/bin/caffeinate -i "$python_bin" "$folder/make-url-batch.py" "$@" || result=$?
printf '\nPress Enter to close this window.'
read -r ignored || true
exit "$result"
