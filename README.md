# Guitar Practice Lab

Guitar Practice Lab is a touchscreen app for practising with chord sheets, backing tracks, and guitar exercises. The kiosk is designed for a 7-inch, 800 × 480 display. It was originally set up on a Raspberry Pi 3 Model B and now runs on a Pi 4 Model B using the same 32-bit Raspberry Pi OS Trixie card. The app uses .NET 10, ASP.NET Core, and HTML and JavaScript practice screens.

## Downloads

Get the ready-to-run files from the [latest GitHub release](https://github.com/ofirasp/glab/releases/latest):

- [Song Studio for macOS](https://github.com/ofirasp/glab/releases/latest/download/Guitar-Lab-Song-Studio-macOS.zip) — unzip and open the app on your Mac.
- [Pi updater for Mac](https://github.com/ofirasp/glab/releases/latest/download/Update-Guitar-Practice-Lab.command) — run this on your Mac to update the Pi over SSH.
- [Pi update ZIP](https://github.com/ofirasp/glab/releases/latest/download/GuitarLab-Update.zip) — alternative update package.

Install the Pi update before using Song Studio’s Edit and image-management features. The Mac app is built for Intel macOS 11 or later; its processing worker requires Python 3.11 or 3.12 and FFmpeg. Source and build instructions are in [tools/mac-song-studio](tools/mac-song-studio/README.txt).

## Home screen

| Menu | What's inside |
| --- | --- |
| **Songs** | Import chord PDFs and MP3s, switch between original and backing audio, and follow timed cues. **FullScreen** offers PDF + Chords and Chord Focus. **Split view** restores the playback panel. |
| **Tools** | Live Guitar Tuner, metronome, Fretboard Map and Looper. |
| **Lessons** | Open JustinGuitar or GuitarZero2Hero, save lesson links with notes, and revisit them later. |
| **Practice** | **1 Minute Changes**, **Change After a Bar**, **Scales**, **Find the Notes**, **Guess the Chord**, **Chord Clean Check**, **Strumming Timing**, and a practice timer. |

**Shut down** asks for confirmation and powers off the Pi. Each request belongs to the current desktop session, so a saved request cannot run again after a restart. **Sleep screen** covers the kiosk with a black saver while keeping the display signal active. **Exit to Desktop** closes the practice kiosk.

The top-right icons open Settings, Sleep screen, Exit to Desktop and Shut down. In **Settings → Screen Saver**, choose Black, Clock, or Guitar photo and preview the style before saving. The idle timeout defaults to 10 minutes and can be set from 1 to 60 minutes using the listed presets. On the Pi's Wayland desktop, the helper activates the kiosk saver after the configured time without input when playback permits. App audio and generated backing tracks request a screen wake lock. The helper also checks media playback reported by Chromium through MPRIS before showing the saver. Touch the display to wake it. The backlight stays on in this mode.

## Songs and timed PDF following

Import a PDF in **Songs → Tools** and attach an MP3. The player supports original and backing versions, volume and mute, speed, A/B loops, and song notes. A matching `-backing.mp3` in the Pi's recordings folder can be found automatically when attaching the corresponding `-original.mp3`. When importing from a Mac, both matching MP3s can be selected together.

For a simplified chord sheet, import the standard PDF and copy the matching `-simple.pdf` into `~/GuitarPracticeLab/recordings` on the Pi. For example, `Linger.pdf` pairs with `Linger-simple.pdf`. Open the song to reveal **Simple** beside the bar controls, in either reading view. The recording keeps playing as you switch sheets. If an older library entry was renamed before filenames were stored, keeping an identical copy of the standard PDF in `recordings` lets the app recover the match.

Use **Mark here** to save the recording time and position on the imported sheet. With **Record Follow**, tap or hold the down arrow while listening, then pause for one second to capture a cue. **Follow** turns on when a song with cues starts or resumes. It interpolates scroll position between cues on the same page. When the next cue is on a later page, it scrolls toward the bottom and turns at the cue time. Manual PDF navigation pauses Follow. Both PDF versions use the same cue times and saved positions, so alignment can differ if their layouts differ. Edit cues on the imported sheet.

Tap a detected chord name or **Chords** to see fingering alternatives and manual lookup. The diagrams support standard E A D G B E tuning. Capo and preferred shapes are remembered per song in the browser. Poppler reads chord text from text PDFs. Scanned sheets may require manual lookup.

The app builds continuous reading copies for multi-page PDFs when PyMuPDF is available, and keeps the original files. Hebrew song titles start the PDF view at the right edge. Other titles start at the left edge.

The Songs header has icon shortcuts for **Library**, **Tools** and **Notes**, with tooltips and accessible names. **Chord Match** sits at the far left of the player row, keeping −5 / Play / +5 together in the controls for normal, clean and full-screen layouts and highlights while active. Song Tools has four tabs: **Files**, **Audio**, **Playback** and **Analyze**. **Record & Review** and **Microphone timing** are in Audio; **Analyze chords**, **Edit chord timeline**, **Sync PDF** and **Rhythm** are in Analyze. Closing an analysis tool returns to the tools dialog.

**Notes** opens directly beside Tools. The title and notes are read-only until you tap **Edit**, so touching them does not open the keyboard. The close X is at the top right; unsaved edits offer Save & close, Discard or Keep editing. The lesson is a **Watch lesson** button, rather than a URL field. The Images tab displays reference images in natural filename order (2 before 10). Previous/Next sits above the image, separate from Close. Zoom from the fitted size up to 300% with −/+ controls, pan the enlarged image by touch, and use Fit to see the full image again. Changing images resets zoom to Fit. The dialog fits an 800 × 480 display without scrolling its frame.

**Analyze chords** compares the original MP3 with the main PDF’s chord names and estimates a timeline. Reanalyze a song to replace an older estimate after updating the analyzer. Chord matching listens throughout each current chord section and counts a confident match once per section. Its **Last score** and **Personal best** are stored in that browser. Completed runs with seeking or looping save a last score, while uninterrupted runs can qualify for a personal best. **Record & Review** captures a take of up to 60 seconds while the song and Follow continue. Replay the guitar alone or with backing, or download the take as WAV.

### Auto PDF sync and chord corrections

Keep recorded Follow for manual control, or choose Auto PDF to align the extracted chord timeline with positions in the PDF. Sync PDF supports next/previous navigation, seeking from the start, skipped sections, repeated chord bars and direct selection of the correct printed chord. Selecting a different chord on the PDF corrects that timeline section. Hebrew chord lines are followed from right to left.

In Edit chord timeline, use Prev/Next to select a section, Split at bar to separate a long detection, and Hear section to preview the complete section. Done saves; Cancel discards. Saving migrates unchanged PDF anchors to the revised timeline rather than clearing all sync work. Automatic chord/rhythm extraction remains approximate; confirm and correct estimates by ear.

## Fullscreen chords and rhythm

For a song with analyzed chords, **FullScreen** shows the current chord and diagram, previous and upcoming chords, a countdown, playback controls, and the running match score. A correct guitar match gives the current card a green outline and checkmark. **Chord Focus** enlarges the diagram, and **PDF View** restores the sheet. The diagram uses a preferred saved shape when available.

The beat strip displays two bars on a fixed grid. Chord sections are labeled and split within a bar, so two chords lasting half a bar each appear as two halves. The diagram rounds estimated change positions to displayed pulses to avoid tiny fragments. Completed pulses are green, the current pulse is yellow, and future pulses are dim. In 6/8, six pulses are grouped 3 + 3, with accents on 1 and 4.

Open **Song tools → Analyze → Rhythm** to set up the beat grid.

1. Use **Analyze Rhythm** for an estimated tempo and possible time signature. Confirm the result by ear. **½ tempo** and **2× tempo** correct half-time or double-time estimates.
2. To set tempo by tapping, choose **Tap beat 1 each bar** or **Tap every beat**. Bar tapping is the default and requires a selected time signature. Two taps give an initial BPM, and further taps refine it. The display shows the tap count, measured interval, and BPM.
3. In 6/8, BPM counts dotted-quarter beats. Tap twice per bar in every-beat mode, on 1 and 4, or once per bar in bar mode.
4. Use **Preview clicks** to check the tempo, then **Save rhythm**. The numeric touch keypad supports decimal BPM values.
5. During playback, tap **Bar starts now** exactly on beat 1. **✓ Bar synced** and the saved time confirm alignment. If the grid gradually drifts, adjust the tempo and synchronize again.

Automatic tempo, meter, chord names, and bar alignment are estimates. A saved tempo and bar start determine the displayed beat grid.

## Live tuner and practice exercises

In **Tools → Guitar Tuner**, choose a tuning from the dropdown. Each visit starts with **Auto string** and **Standard tuning**, with Drop D, Half Step Down, Whole Step Down, DADGAD, and Open G also available. The selected tuning determines the string labels, reference tones, and target pitches. In-tune strings turn green and play a confirmation chime. Green strings stay confirmed until you tap their circle to restore its neutral color and tune again. The tuner shows a checkmark when all six strings are in tune.

- **1 Minute Changes** shows both chord diagrams before Start. Choose each chord's root and type and use the arrows to select its shape. The exercise assumes standard tuning with no capo. **Recent** restores both chords and their selected shapes. The app uses the saved microphone and counts a stable match before moving to the other chord. Completed rounds save on the Pi, and the app shows the pair’s last score and personal best. Recognition is experimental and works best with clean guitar sound and headphones.
- **Change After a Bar** alternates a chord pair at the chosen tempo, meter and number of changes. The one-bar count-in sounds even with exercise clicks off. Both chord diagrams stay visible while playing. Results separate chord-change matches from strum timing, with early/late feedback and saved browser history. The beat grid stays fixed. A swinging visual metronome is centered above both chord shapes during practice. Its swing endpoints align with the exercise beat clock, beat 1 has a stronger gold flash, and BPM/meter are shown below. It works with clicks off and stops on cancel or completion; reduced-motion settings keep the pulse without the swing. **Pattern** opens an arrow-based editor: tap eighth-note slots to cycle rest (—), down (↓) and up (↑), or choose a preset. The live strip shows the selected strokes. In quarter-note meters each beat has two eighth slots; in compound meters each pulse is already an eighth note. Timing scoring expects only the selected strums, not rests. Direction is a visual guide, not inferred from the microphone. The last selection and eight recent patterns are saved per browser, with recent choices shown for the current time signature. Results retain the pattern and compare matching setups separately.
- **Guess the Chord** offers an end-of-round result and feedback before the final popup.
- **Follow the Notes** highlights scale notes on the beat with a count-in, tempo control, and optional reference tones. It supports major and minor pentatonic in all 12 keys. For the open C major pattern, choose **C → Major → Open position**. The up-and-down sequence starts at the A string, fret 3, and passes through open low E before returning to C.
- **Play Along** shows a scale beside a generated chord loop, an MP3 from the Pi’s `recordings/Scale-Backing-Tracks` folder, or a local audio file. The built-in loop follows the selected key and scale. Choose the key yourself for recorded tracks.
- **Fretboard Map** shows five fret positions at a time through fret 24. Tap to hear a note, highlight a pitch or scale, switch between note names and intervals, or use **Find the Note** to practise identifying positions. Open-string circles sit beside the nut. Enable **Use mic** in Find the Note to answer by playing the requested note in any octave using the saved Pi microphone. A stable correct note advances the question. **Hear target** plays a reference tone, with feedback for muted or zero volume.

- **Chord Clean Check** checks the notes of a chosen shape one string at a time. Use the arrows to change shapes and set the tuning and capo to match your guitar.
- **Strumming Timing** scores strums as on time, early, late, or missed. It starts with a silent visual beat and also offers audible clicks.
- **Looper** records the guitar from the Pi microphone. Stop, name and save the take, then replay it on a loop or delete it from the list. The input peak reading warns when captured samples reach maximum level. Playback has its own volume slider, and short edge fades reduce clicks at the loop boundary.

The live microphone tools use a USB microphone on the Pi and `alsa-utils`. Capture runs on the Pi through ALSA. If the default device fails, try the USB microphone's `plughw:CARD=…,DEV=…` entry. Completed 1 Minute Changes scores are saved on the Pi. Bar Changes, Strumming Timing and song Chord Match also keep their results in the current browser profile. Clearing browser data removes those browser-only scores. Looper saves audio when you name and save a take.

### Audio timing calibration

Open **Settings → Audio** from the gear icon, or Microphone timing in the song’s Audio tools. Select the microphone, wait through four count-in pulses, strum once with each of the eight slow STRUM beeps, then Apply correction. The correction is saved per microphone in the browser profile and used by Bar Changes and song Chord Match. Recalibrate after changing the audio output. Calibration uses the same timestamped capture path and strum detector as Bar Changes; its results include the applied correction and average residual offset.

Standalone Strumming Timing keeps its original raw-stream clock and does not apply the chord-stream correction. This avoids shifting the previously working exercise by a correction measured through a different capture path. Timing and recognition tests use simulated audio; they do not establish accuracy on every microphone or guitar.

## Lessons

Open **Lessons → Add Lesson** to save a URL with a title and notes. On the Pi, a lesson opens in a separate Chromium window. Its **← Practice** tab offers **Save current lesson** to capture the active lesson's title and address, and **Return to Practice** to close the lesson window. Website sign-in and playback are handled by Chromium in its dedicated lesson profile.

To attach a lesson, open **Lessons → Edit → Link to song**, search or scroll the touch-friendly song picker, select a song and save. The saved row uses the song’s name. Song Notes shows Watch lesson, and opening it pauses song playback. Notes text is available in the editor rather than repeated in every list row.

Song Studio can also save the lesson URL directly. Existing song links appear automatically in Lessons without making a duplicate URL entry. Editing a song-linked lesson updates the song’s URL and notes. Choosing No song detaches the link and retains a saved lesson. Remapping validates both song revisions and preserves the target song’s practice notes.

## Song Studio for Mac

Connect with the Pi login (default `ofiras@glab.local`) and password, or leave the password empty to use a working SSH key. The main window then opens **Upload** and **Edit** tabs. The password is kept in memory for the app session and is not saved.

- **Upload:** enter a YouTube/YouTube Music URL, choose a chord PDF and song name, then Create & Send to Pi. The Mac prepares an original and vocal-reduced backing MP3, sends the files, and can import/analyze the song on the Pi. Output names are `Song.pdf`, `Song-original.mp3` and `Song-backing.mp3`. Matching files require explicit replacement; recovery copies are kept.
- **Edit:** load the Pi’s actual library, select a song, edit notes and lesson URL, add reference images, and Save to Pi. Saved images can be selected and marked with Remove image; Save to Pi applies removals. Clear pending cancels unsaved uploads and removals. Same-name uploads add another image rather than replacing one.

PNG, JPEG, HEIC and WebP input is converted on the Mac to JPEG up to 2400 pixels on the long edge. The Pi accepts up to 30 images per song, 8 MB per converted image. Successfully uploaded/removed images are cleared from the pending list so a partial failure can be retried. A newer song revision on the Pi must be reloaded before editing, preventing silent overwrites.

Build the native app on a Mac:

```bash
python3 tools/mac-song-studio/build.py /path/to/output
```

The build uses Swift/AppKit and creates an ad-hoc signed app and ZIP. First-time audio processing can download vocal models. Tests use local fixtures and a temporary Pi API; no live YouTube download or transfer to the user’s Pi is part of the automated checks.

## Run locally

Install the .NET 10 SDK. Use the Linux ARM SDK on 32-bit Raspberry Pi OS. The Pi needs ALSA utilities for capture, FFmpeg for audio, Poppler for PDF rendering, and PyMuPDF for continuous reading copies.

```bash
sudo apt-get update
sudo apt-get install -y alsa-utils ffmpeg poppler-utils python3-pymupdf git curl
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
| `~/GuitarPracticeLab/song-library` | Imported PDFs and MP3s, metadata, notes, lesson URLs, reference images and cues |
| `~/GuitarPracticeLab/recordings` | Loose recordings and matching simple PDFs |
| `~/GuitarPracticeLab/lessons/links.json` | Saved lesson links and notes |
| `~/GuitarPracticeLab/chord-practice/results.json` | Completed 1 Minute Changes scores |
| `~/GuitarPracticeLab/loops` | Saved Looper recordings |
| `~/GuitarPracticeLab/lesson-browser` | Desktop helper state |

Storage overrides include `GUITAR_SONG_LIBRARY`, `GUITAR_RECORDINGS_ROOT`, `GUITAR_LESSONS`, `GUITAR_CHORD_PRACTICE`, `GUITAR_LOOPS_ROOT`, and `GUITAR_LESSON_BROWSER`. The web service and desktop helper must use the same bridge location.

- [Pi kiosk startup and recovery tools](tools/pi-kiosk/README.txt)
- [Mac Song Studio](tools/mac-song-studio/README.txt) — Upload/Edit desktop companion.
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

Additional checks for the current song-management and timing features:

```bash
node tests/bar-changes-engine.test.cjs
node tests/guitar-strum-timing.test.cjs
node tests/timing-adjustment.test.cjs
node tests/pdf-chord-alignment.test.cjs
python3 tests/mac-song-studio.test.py
GPL_TEST_DOTNET=/path/to/dotnet python3 tests/song-studio-edit-api.test.py
```

The API check uses the compiled Debug application and temporary storage. UI checks include `song-notes-images-ui.test.cjs`, `song-lesson-links-ui.test.cjs`, `global-audio-settings.test.cjs` and `bar-changes-ui.test.cjs`; set `GPL_TEST_CHROME` to your local Chrome binary and make Playwright available through Node. Mac image conversion and password-terminal tests need macOS facilities.

Bar Changes separates Tempo and Changes with Time signature between them. Each value has 44px arrows on opposite sides. Tap changes by 1; holding repeats after 400 ms and accelerates to aligned steps of 5 after one second and 10 after two seconds. Release, cancellation, focus loss and page hiding stop the repeat, without an extra release click.

Change After a Bar uses a symmetric timing allowance of up to ±180 ms. At faster tempos and closely spaced eighth notes, the window narrows to stay below half the distance between expected strums. Results display the applied window alongside calibration and average offset. Standalone Strumming Timing and microphone attack sensitivity are unchanged.

Sync PDF displays correction errors inside its side panel instead of adding a third grid item that displaces the PDF. Manual slash-chord timeline corrections such as Fmaj7/G and C/G are accepted and retain their exact names. Automatic chord analysis continues to omit slash candidates until bass inference is reliable.

Playback controls use matching icons throughout the app, including restart, seek, play/pause and stop. Chord Match sits first in the song player row. Back arrows sit at the top left, including One Minute Changes; dialog close controls use a top-right X while preserving their save and discard actions.

Sync PDF corrections, skipped detections, repeated-bar positions, reading direction and Auto/Manual mode are saved in the Pi song library. Other browsers load the same settings when opening the song. Existing browser corrections migrate on first opening if no shared copy exists; refresh the other browser after editing. Manual recorded Follow cues are preserved.

The song player’s Chord Match icon starts practice directly with the configured microphone and normal playback countdown. Microphone setup stays in Settings → Audio. Song Notes shows personal bests and recent chord/timing scores; the final results popup offers Play again.

### Back up and restore Pi data

Song Studio 2.2 adds a **Backup** tab after connecting to the Pi. Exit the Pi app to the desktop, close its lesson browser, and stop recordings before backup or restore. **Back up Pi to Mac** saves a new verified archive to your chosen Mac folder. It includes songs and media, images, notes, cues, chord/rhythm analysis, PDF sync corrections, loops, practice results, lessons, settings, and Pi browser profiles (including local scores and preferences). Mac-browser data and custom storage outside the default Pi folders are excluded, as are caches, builds, logs, old backups and transient commands.

**Restore Mac backup to Pi** validates and stages an archive before merging its files into the Pi. Files absent from the archive remain; matching files are replaced with safety copies under `~/GuitarPracticeLab/backups/before-restore-*`. Restart the Pi afterward. Backups contain browser session data and should be kept private. They restore app data, not the operating system.
