# Chord popup update

Run `bash tools/chord-update/install.sh` on the Pi from the repository root.
The installer also works from the standalone update ZIP's extracted directory.
It supports the current Pi source version copied into this repository, and repeat
installation of the same update. Unexpected source changes stop installation
before overwriting app files.

The standalone Mac `.command` launcher must sit next to
`GuitarLab-Chord-Update.zip`. It transfers the update and runs the Pi installer.
SSH authentication is shared across transfer/install so the Pi SSH password is
normally needed once. Sudo may separately request the Pi password. No password
is stored. Keep the Pi and Mac on the same network; don't disconnect power while
installation is running.

The install backs up the seven changed/new files and the previous published app
under `~/GuitarPracticeLab/backups/chord-shapes-*`. It builds before stopping the
service and restores the previous source/deployment if startup fails. The song
library, recordings, notes and cues stay in their existing directories.

After installing, close and reopen the kiosk browser to load updated scripts.
Tap an underlined chord or **Chords**, then choose **Standard E A D G B E** if that
matches the guitar. Other tuning hides diagrams. Use Previous/Next to browse
positions; the last selected shape and capo choice are saved per song in that
browser. Frets are relative to the capo. This does not transpose chord names.

Detection requires a text PDF. Scanned PDFs, split glyphs, embedded chord images,
and some font encodings need manual chord lookup; OCR is not included. Unknown
chord spellings show an explicit message rather than an invented diagram.

Follow turns on automatically on every playback start/resume when the song has
saved cues. Manual Follow off and manual PDF navigation still work during the
current playback. A new Play action turns it back on. Songs without cues stay off.

To build a single-file Mac installer, run:
`python3 tools/chord-update/build-update.py /path/to/output`
Then double-click `Update Guitar Practice Lab.command`. It contains the complete
update payload; no separate ZIP needs to be downloaded. This updates either the
original Pi source or the previous chord-popup version, while rejecting unknown
local edits. Reopen the Pi browser after installation.
