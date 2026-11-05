Run a list of YouTube links as one backing-track batch

1. Put your individual video links in urls.txt, one per line.
2. Double-click Make URL Batch and Send to Pi.command.
3. Enter the Pi's normal SSH password when asked. Keep the Pi connected to the
   same network, this window open, and the Mac lid open.

The helper uses the existing Mac vocal-removal tools. It checks the Pi connection
first, then downloads and processes one URL at a time, sending each completed
original/backing pair to ~/GuitarPracticeLab/recordings on the Pi.
The shared SSH connection normally requires one password entry. No password is
stored. Host-key verification is preserved. Changing network or losing the SSH
connection may require authentication again.

Completed pairs are verified and reused on reruns. Interrupted separation keeps
the exact downloaded original. A failed URL is recorded and the next URL is tried.
Run the same command again to retry failures or resend files after a connection
problem. A lock prevents two copies from processing the same output folder.

Mac files and report:
~/Documents/Codex/GuitarPracticeLabAudio/YouTubeBatch/
Report: last-url-batch-report.json

On the Pi, open Songs, choose/import the PDF and attach the matching -original.mp3.
With the automatic backing update installed, its -backing.mp3 in recordings will
be attached too. This batch does not replace existing song recordings or cues.

To use a different list later, edit urls.txt: one individual video URL per line.
Blank lines and lines starting with # are ignored; duplicate video IDs are skipped.
The batch does not bypass private, restricted, unavailable or DRM-protected media.

Requirements: Python 3.11/3.12, ffmpeg, ffprobe and the same Demucs setup used by the
single-track helper. The first run may download dependencies and model weights.
For local preparation without the Pi, run:
python3 make-url-batch.py --no-transfer

No song list or generated tracks are included in this repository. The Mac command
asks for your SSH credentials interactively.
