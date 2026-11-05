# Guitar Practice Lab

Touchscreen guitar practice app built for a Raspberry Pi 3 Model B and a 7-inch display. The current app uses ASP.NET Core / Blazor Server with HTML/JavaScript practice screens.

## Features

- Guitar pitch test and uploaded WAV analysis.
- Practice dashboard and timer.
- Song library with imported chord PDFs and local MP3 playback.
- Original/backing track selection, volume and mute.
- PDF zoom, reading view and manually marked sections that follow playback.
- A/B loops, playback speed, notes, song editing and deletion.
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
dotnet run --project src/GuitarPracticeLab.Web --no-launch-profile --urls http://127.0.0.1:5080
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
