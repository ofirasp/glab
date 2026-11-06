# Guitar Practice Lab

Touchscreen guitar practice app built for a Raspberry Pi 3 Model B and a 7-inch display. The current app uses ASP.NET Core / Blazor Server with HTML/JavaScript practice screens.

## Features

- Guitar pitch test and uploaded WAV analysis.
- Practice dashboard and timer.
- Song library with imported chord PDFs and local MP3 playback.
- Original/backing track selection, volume and mute.
- PDF zoom, reading view and manually marked sections that follow playback. Follow turns on automatically whenever playback starts or resumes for a song with cues. You can turn it off or scroll manually during playback.
- A/B loops, playback speed, notes, song editing and deletion.
- Tap PDF chord names for diagrams and alternative shapes; song chord list and manual lookup.
- English/Hebrew touch keyboard.

This repository contains the source copied from the Pi, plus the Mac backing-track helpers and Pi kiosk startup tools. Recordings, chord PDFs, personal library data, generated media and build output are excluded.

## Run

Install the .NET 10 SDK. On Raspberry Pi OS, install the audio/PDF utilities:

```bash
sudo apt-get update
sudo apt-get install -y alsa-utils ffmpeg poppler-utils git curl
```

From the repository root:

```bash
dotnet restore src/GuitarPracticeLab.Web/GuitarPracticeLab.Web.csproj
dotnet run --project src/GuitarPracticeLab.Web --no-launch-profile --urls http://127.0.0.1:5080 --environment Development
```

Open `http://127.0.0.1:5080/`. The app is used over HTTP locally. The copied source still includes the template HTTPS redirection middleware; without a configured HTTPS port it can log a warning while serving HTTP.

The existing Pi deployment uses a `guitar-practice-lab` system service and publishes to `~/GuitarPracticeLab/published`. Publishing alone does not install that service:

```bash
dotnet publish src/GuitarPracticeLab.Web/GuitarPracticeLab.Web.csproj -c Release -o "$HOME/GuitarPracticeLab/published"
```

Stop the existing service before replacing its published files and restart it afterward. Back up the library and current deployment first.

## Library storage

By default:

- `~/GuitarPracticeLab/song-library`: song metadata, imported documents/audio and rendered pages.
- `~/GuitarPracticeLab/recordings`: available recordings.

Override these with `GUITAR_SONG_LIBRARY` and `GUITAR_RECORDINGS_ROOT`. Library data is separate from application publishing. Back up the entire library directory to preserve notes, cues and attachments.

PDF following uses saved manual positions and timings. It does not automatically recognize the lyrics or chords. Playback uses local media; a YouTube subscription is not integrated into the app.

## Tools

- `tools/pi-kiosk/`: kiosk startup/recovery scripts and their installation instructions. These target the existing Pi installation and desktop setup.
- `tools/mac-backing/`: Mac helpers for processing tracks and sending results to the Pi; see their README. Supply your own URL list. Use media you have permission to process.

## Hardware and access

Development hardware: Raspberry Pi 3 Model B, 32-bit Raspberry Pi OS Trixie, 7-inch touch display, wired audio. Capture hardware is needed for microphone input. The source targets .NET 10; use the Linux ARM distribution on the 32-bit Pi.

The app has no account/login layer and can modify local song-library files. Keep it on the Pi or a trusted private network; do not expose it directly to the internet.

## Chord diagrams

Tap an underlined chord in the PDF, or tap **Chords**. Choose the guitar tuning before displaying a shape. This version supports standard E A D G B E tuning only; selecting other tuning hides the diagrams. Capo and preferred shapes are remembered per song in that browser. Frets are relative to the selected capo and chord names are interpreted as written, without automatic transposition.

Text PDFs are detected with Poppler's `pdftotext`. Scanned pages, split glyphs and some PDF font encodings may not expose chord text; manual lookup remains available. Detection can include chord-like words and uncommon spellings may have no diagram. Generated compact voicings are checked against chord tones and the requested bass; fingering comfort still depends on the player. No OCR or alternate-tuning shape library is included.

Existing Pi installations can run `bash tools/chord-update/install.sh` from a checkout copied to the Pi. It checks source compatibility, backs up changed files, builds before replacing the running deployment and restores the previous version if startup fails. It does not change song data. Reopen the browser after installation.

Checks:

```bash
node tests/chord-shapes.test.cjs
dotnet run --project tests/PdfChordChecks
```

## 1 Minute Changes

Open **Practice → 1 Minute Changes**, choose a **Root** (C, D, F♯…) and **Type** (Major, Minor, 7…) for each of the two chords, select the
Pi's microphone and confirm **standard tuning, no capo**. Start connects to the
microphone; the sixty-second countdown begins only when audio is available.
Play the displayed chord cleanly and let it ring. A stable match counts once and
switches to the other target. Holding/restrumming the previous chord does not add
points. At sixty seconds, the round ends and saves automatically on the Pi.

The score reports **correct chords played** and **changes** (one fewer than the
number of chords, since the first chord is not a change). Results includes recent
scores for each pair. Cancelled rounds are not saved. Switching away from the
exercise or hiding the browser cancels an active round. A failed save keeps the
result available for **Retry save** and blocks another start until saved.

This is experimental polyphonic recognition, not a guarantee that every string
was fingered correctly. It uses harmonic note fitting and compares the two chosen
chords. Extended chords may omit their perfect fifth. Equivalent note sets such
as Am7/C6 are rejected because this detector cannot reliably distinguish them.
Similar chords, tuning, room noise, guitar timbre and microphone position affect
accuracy. Use clean acoustic guitar sound and headphones; speaker playback can
be mistaken for your instrument. No recording is retained.

A USB microphone connected to the **Pi** and `alsa-utils` are required. Audio is
captured by the Pi service with ALSA (`arecord`), so this also works when viewing
the app from a Mac over HTTP; the Mac microphone is not used. If default capture
fails, choose the USB microphone's `plughw:CARD=...,DEV=...` entry. The service user
must have permission to access the capture device. The app never starts a fake
round or counts demo input when capture is unavailable.

Results live outside the published app at `~/GuitarPracticeLab/chord-practice/results.json`.
Override the directory with `GUITAR_CHORD_PRACTICE`. Back it up with your library.
At most the latest 100 results are returned to the UI; the storage file retains
all completed results. Raw microphone samples are processed in memory only.

Detector checks: `dotnet run --project tests/ChordPracticeChecks`. The test uses
synthetic guitar-like harmonics and does not establish real microphone accuracy.
The browser exercise test is `tests/one-minute-ui.test.cjs` and requires Playwright.

## Lesson sites and saved lessons

Open **Lessons** from Practice or Songs. JustinGuitar and GuitarZero2Hero have
large browse buttons. **Save a lesson** stores a title, direct page link and notes
on the Pi; **Refresh** picks up links added from another browser. Remove has Undo.
The app stores links, not downloaded lesson videos or website account details.

In Songs, use **Add lesson** (or Song notes) to attach a URL. A linked song shows
**Watch lesson**. Alternatively open Lessons from that song and choose **Link to
song** on a saved lesson. Linking does not change the PDF, recordings or cues.
Watching pauses app audio; close the lesson window to continue where you left it.

On the Pi kiosk, a small desktop helper opens a separate, maximized Chromium
window with normal browser controls. Its first tab is **← Practice** with a large
**Return to Practice** button that closes only this dedicated lesson browser.
It uses a separate profile at `~/.config/guitar-lab-lessons`; normal site logins
and cookies remain in that browser. The app does not handle lesson-site passwords.
Exit the website player's fullscreen mode before using the Return tab.

The updater installs `~/.config/autostart/guitar-lab-lessons.desktop`. **Restart
the Pi once after installing** so the helper starts inside the desktop session.
The helper is `Desktop/lesson-browser.py` in the source project, rather than a
process launched by the system web service. Browser commands are accepted only
from loopback, with same-origin checks; they contain validated HTTP(S) URLs and
never shell commands. If the helper is unavailable, the kiosk shows a restart
message instead of sending you into an external tab without a return path.

From a Mac or other remote browser, lessons open in a normal separate browser
window. Close it to return to the app. Website logins, video availability,
subscriptions and playback quality remain controlled by each site. On the Pi 3,
try 480p first and keep only one video playing; actual playback performance still
needs checking on the device. No iframe embedding, content scraping or video
downloading is used by this feature.

Saved bookmarks live at `~/GuitarPracticeLab/lessons/links.json` (override with
`GUITAR_LESSONS`). Song lesson links live in the existing `song.json` metadata.
The desktop bridge uses `~/GuitarPracticeLab/lesson-browser` (override with
`GUITAR_LESSON_BROWSER` for both service and helper). Back up lesson bookmarks
alongside your song library. Archived bookmarks are retained for recovery.

Checks: `dotnet run --project tests/LessonUrlChecks`,
`python3 tests/lesson-browser.test.py`, and `tests/lessons-ui.test.cjs` with
Playwright against an isolated app. The desktop helper is tested with fake
browser processes; native Pi desktop/video playback has not been verified here.

Save a lesson without a keyboard: browse to the actual lesson in the Pi lesson
browser, tap its **← Practice** tab, then **Save current lesson**. The preview
shows the current lesson title and address. Tap **Return to Practice** to return
to the app; the link appears in Lessons → Saved lessons. Saving again preserves
existing notes and titles without duplicating the link. Restart the Pi once after
installing this update. This capture feature runs only in the dedicated Pi lesson
browser, using a small extension with tabs/storage permissions; it remembers tab
titles and addresses for the current browser session, without reading page content,
cookies or passwords. Ordinary Mac lesson popups still use manual link entry.

Practice now includes **Follow the Notes** and **Play Along**. Both offer all
12 keys in major and minor pentatonic scales, with a standard-tuning fretboard
and root-note markers. Follow the Notes has ascending, descending and up/down
sequences, a four-beat count-in, tempo controls, optional reference notes and
manual stepping. Targets advance on the beat; these exercises do not use the
microphone or score accuracy. Play Along offers a generated root/fifth groove
that follows the selected key, attached song-library backing tracks, or an
audio file selected on the current device (not uploaded). Imported recordings
are not analysed or transposed: choose their matching scale/key yourself.
Volume, mute, pause, reset and recording looping work without a keyboard.
Playback pauses when the page is hidden. Recording tempo remains unchanged.

Checks: `node tests/scales.test.cjs` and the Playwright touchscreen/audio test
`node tests/scale-practice-ui.test.cjs`. UI tests use a generated WAV and a
fixture library; real Pi speaker playback has not been verified here.
