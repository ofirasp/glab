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

Open **Practice → 1 Minute Changes**, choose two different chord names, select the
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
