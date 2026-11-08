# Guitar Practice Lab

Guitar Practice Lab is a touchscreen app for practising with chord sheets, backing tracks, and guitar exercises. The kiosk is designed for a 7-inch, 800 × 480 display. It was originally set up on a Raspberry Pi 3 Model B and now runs on a Pi 4 Model B using the same 32-bit Raspberry Pi OS Trixie card. The app uses .NET 10, ASP.NET Core, and HTML and JavaScript practice screens.

## Home screen

| Menu | What's inside |
| --- | --- |
| **Songs** | Import chord PDFs and MP3s, switch between original and backing audio, and follow timed cues. **FullScreen** expands the PDF. **Split view** restores the playback panel. |
| **Tools** | Tuner demo with WAV analysis, metronome, Fretboard Map, and **Scales → Follow the Notes**. |
| **Lessons** | Open JustinGuitar or GuitarZero2Hero, save lesson links with notes, and revisit them later. |
| **Practice** | **1 Minute Changes**, **Play Along**, and a practice timer. |

**Shut down** asks for confirmation and powers off the Pi. Each request belongs to the current desktop session, so a saved request cannot run again after a restart. **Sleep screen** covers the kiosk with a black saver while keeping the display signal active. **Exit to Desktop** closes the practice kiosk.

On the Pi's Wayland desktop, the helper activates the kiosk saver after 10 minutes without input when playback permits. App audio and generated backing tracks request a screen wake lock. The helper also checks media playback reported by Chromium through MPRIS before showing the saver. Touch the display to wake it. The backlight stays on in this mode.

## Songs and timed PDF following

Import a PDF in **Songs → Tools** and attach an MP3. The player supports original and backing versions, volume and mute, speed, A/B loops, and song notes. A matching `-backing.mp3` in the Pi's recordings folder can be found automatically when attaching the corresponding `-original.mp3`. When importing from a Mac, both matching MP3s can be selected together.

For a simplified chord sheet, import the standard PDF and copy the matching `-simple.pdf` into `~/GuitarPracticeLab/recordings` on the Pi. For example, `Linger.pdf` pairs with `Linger-simple.pdf`. Open the song to reveal **Simple version** next to the zoom controls, in either reading view. The recording keeps playing as you switch sheets. If an older library entry was renamed before filenames were stored, keeping an identical copy of the standard PDF in `recordings` lets the app recover the match.

Use **Mark here** to save the recording time and position on the imported sheet. **Follow** turns on when a song with cues starts or resumes. It interpolates scroll position between cues on the same page. When the next cue is on a later page, it scrolls toward the bottom and turns at the cue time. Manual PDF navigation pauses Follow. Both PDF versions use the same cue times and saved positions, so alignment can differ if their layouts differ. Edit cues on the imported sheet.

Tap a detected chord name or **Chords** to see fingering alternatives and manual lookup. The diagrams support standard E A D G B E tuning. Capo and preferred shapes are remembered per song in the browser. Poppler reads chord text from text PDFs. Scanned sheets may require manual lookup.

## Practice exercises

- **1 Minute Changes** shows both chord diagrams before Start. Choose each chord's root and type and use the arrows to select its shape. Confirm standard tuning with no capo, then select the Pi's microphone. Once the microphone connects, the app counts a stable match and moves to the other chord. Completed rounds save on the Pi. Recognition is experimental and works best with clean guitar sound and headphones.
- **Follow the Notes** highlights scale notes on the beat with a count-in, tempo control, and optional reference tones. It supports major and minor pentatonic in all 12 keys. For the open C major pattern, choose **C → Major → Open position**. The up-and-down sequence starts at the A string, fret 3, and passes through open low E before returning to C.
- **Play Along** shows a scale beside a generated chord loop, an MP3 from the Pi’s `recordings/Scale-Backing-Tracks` folder, or a local audio file. The built-in loop follows the selected key and scale. Choose the key yourself for recorded tracks.
- **Fretboard Map** shows five fret positions at a time through fret 24. Tap to hear a note, highlight a pitch or scale, switch between note names and intervals, or use **Find the Note** to practise identifying positions.

A USB microphone on the Pi and `alsa-utils` are needed for 1 Minute Changes. Capture runs on the Pi through ALSA. If the default device fails, try the USB microphone's `plughw:CARD=…,DEV=…` entry. Only completed scores are saved. Raw audio is processed in memory.

## Lessons

Open **Lessons → Add Lesson** to save a URL with a title and notes. On the Pi, a lesson opens in a separate Chromium window. Its **← Practice** tab offers **Save current lesson** to capture the active lesson's title and address, and **Return to Practice** to close the lesson window. Website sign-in and playback are handled by Chromium in its dedicated lesson profile.

To link a saved lesson to a song, open **Songs → Tools → Saved lessons**, then use **Link to song**. The song then shows **Watch lesson**. Opening the lesson pauses song playback.

## Run locally

Install the .NET 10 SDK. Use the Linux ARM SDK on 32-bit Raspberry Pi OS. The Pi needs ALSA utilities for capture, FFmpeg for audio, and Poppler for PDFs.

```bash
sudo apt-get update
sudo apt-get install -y alsa-utils ffmpeg poppler-utils git curl
dotnet run --project src/GuitarPracticeLab.Web --no-launch-profile --urls http://127.0.0.1:5080 --environment Development
```

Run the `dotnet` command from the repository root and open `http://127.0.0.1:5080/`. The app serves local HTTP. Keep it on the Pi or a trusted private network because the library has no login layer. Shutdown and screen sleep requests are restricted to the local kiosk origin.

## Update an existing Pi installation

The updater expects the source project at `~/GuitarPracticeLab/GuitarPracticeLab.Web` and a `guitar-practice-lab` system service that uses `~/GuitarPracticeLab/published`. It checks source compatibility, backs up the current deployment, builds the new version, and rolls back if startup fails. Library data lives outside the published app.

From the repository root, build the Mac installer and ZIP:

```bash
python3 tools/chord-update/build-update.py /path/to/output
```

On the Mac, run **Update Guitar Practice Lab.command**. The default SSH destination is `ofiras@glab.local`. Set `GPL_PI_TARGET` to override it. You can also run `bash tools/chord-update/install.sh` from a checkout on the Pi.

**Restart the Pi once after installing** to load the desktop helper. The updater installs `~/.config/autostart/guitar-lab-lessons.desktop`, which starts `Desktop/desktop-session.py` in the logged-in desktop session. The installer includes the Wayland screen blanking and media status tools.

## Data and utilities

Back up the library and practice data separately from the code.

| Default location | Contents |
| --- | --- |
| `~/GuitarPracticeLab/song-library` | Imported PDFs and MP3s, song metadata, notes, and cues |
| `~/GuitarPracticeLab/recordings` | Loose recordings and matching simple PDFs |
| `~/GuitarPracticeLab/lessons/links.json` | Saved lesson links and notes |
| `~/GuitarPracticeLab/chord-practice/results.json` | Completed 1 Minute Changes scores |
| `~/GuitarPracticeLab/lesson-browser` | Desktop helper state |

Storage overrides include `GUITAR_SONG_LIBRARY`, `GUITAR_RECORDINGS_ROOT`, `GUITAR_LESSONS`, `GUITAR_CHORD_PRACTICE`, and `GUITAR_LESSON_BROWSER`. The web service and desktop helper must use the same bridge location.

- [Pi kiosk startup and recovery tools](tools/pi-kiosk/README.txt)
- [Mac backing-track tools](tools/mac-backing/README.txt). Demucs runs on the Mac to generate instrumental backing tracks for playback on the Pi.
- [Pi updater details](tools/chord-update/README.md)

## Checks

```bash
node tests/scales.test.cjs
node tests/fretboard-notes.test.cjs
node tests/chord-shapes.test.cjs
python3 -B tests/desktop-power.test.py
python3 tests/chord-installer.test.py
dotnet run --project tests/PdfChordChecks
dotnet run --project tests/ChordPracticeChecks
dotnet run --project tests/LessonUrlChecks
```

The `*-ui.test.cjs` and `auto-follow.test.cjs` tests use Playwright. The desktop power tests simulate shutdown and screen blanking, and the chord detector tests use synthetic audio.
