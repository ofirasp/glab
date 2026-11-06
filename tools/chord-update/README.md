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

The install backs up the changed/new files and the previous published app
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

The cumulative update now includes **Practice → 1 Minute Changes**. A connected
Pi microphone and ALSA capture permissions are needed. Confirm standard tuning
with no capo; use headphones and a quiet room. Completed sixty-second results
save on the Pi under `~/GuitarPracticeLab/chord-practice`, outside publishing.
Detection is experimental and must be checked against your real guitar/microphone.
Synthetic tests and a full simulated capture round passed; real Pi microphone
accuracy has not been measured in this session.

Lessons update: restart the Pi once after this installer finishes. It adds a
standard desktop autostart entry for the lesson-browser helper. The helper opens
lesson sites in a dedicated Chromium window; its **← Practice** tab contains a
large Return button. Existing kiosk startup scripts are unchanged. Closing the
lesson browser reveals the original app window. On a Mac, close the ordinary
lesson popup to return. Saved links and per-song lesson URLs stay on the Pi.

Save a lesson without a keyboard: browse to the actual lesson in the Pi lesson
browser, tap its **← Practice** tab, then **Save current lesson**. The preview
shows the current lesson title and address. Tap **Return to Practice** to return
to the app; the link appears in Lessons → Saved lessons. Saving again preserves
existing notes and titles without duplicating the link. Restart the Pi once after
installing this update. This capture feature runs only in the dedicated Pi lesson
browser, using a small extension with tabs/storage permissions; it remembers tab
titles and addresses for the current browser session, without reading page content,
cookies or passwords. Ordinary Mac lesson popups still use manual link entry.
