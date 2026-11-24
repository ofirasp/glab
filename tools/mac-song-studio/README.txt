GUITAR LAB SONG STUDIO — MAC APP

1. Open Guitar Lab Song Studio.app. Enter the Pi login (default: ofiras@glab.local) and password, then press Connect. Leave the password blank if your SSH key works. The password stays only in memory for this app session.
2. The main window has two tabs: Upload and Edit.
3. Upload: paste a YouTube / YouTube Music URL, choose the PDF, and enter the song name. Click Create & Send to Pi. Existing backing-track preparation and import options remain available.
4. Edit: the app loads the songs actually on the connected Pi. Choose a song, change its practice notes and lesson URL, optionally Add images, then Save to Pi. To remove an image, select it in the saved-images list and press Remove image, then Save to Pi. Clear pending cancels pending uploads and removals before saving. PNG, JPEG, HEIC and WebP files are converted to JPEG (long edge up to 2400 pixels). Uploads are limited to 8 MB per converted image and 30 images per song.
5. Install the accompanying Pi update first. On the Pi open Song notes. Notes includes the title, lesson link and notes. Images shows the uploaded images with Previous / Next navigation, without scrolling the dialog.
6. Refresh reloads the library. Unsaved edits prompt before changing songs or refreshing. A song changed on the Pi after loading must be refreshed before saving. Notes and links may be saved before a later image fails; successfully uploaded images are removed from the pending list so you can retry those left.

The filenames are exactly:
  Song name.pdf
  Song name-original.mp3
  Song name-backing.mp3

Import into the Pi song library and Analyze chords and rhythm are on by default. Capo is the pitch shift used for chord analysis. An unclear time signature defaults to 4/4. Open Library on the Pi to see the imported song. Use the current Pi app update so Library refreshes after imports from the Mac.

The app remembers the Pi login, but never saves the password. The password is passed in memory through a private terminal channel, the same SSH method as Terminal, not command-line arguments or a password file. You may reuse it for more jobs during the same app session.

Names already present on the Pi are not replaced unless Replace matching files is enabled. Replacements keep recovery copies in:
  ~/GuitarPracticeLab/recordings/.song-studio-backups/
When the original audio changes, the Pi resets old timing/analysis as usual. Existing manual chord corrections and rhythm are kept when that original is unchanged.

If import or analysis cannot finish, sent files remain in the Pi recordings folder and the app reports what needs attention. Show details opens the processing log. Cancel stops processing; finished Mac files are kept.

Mac copies:
  ~/Documents/Codex/GuitarPracticeLabAudio/
Audio tools and models are reused from:
  ~/Documents/Codex/GuitarPracticeLabTools/

This build is for the current Mac. It uses the existing Python 3.11/3.12 and FFmpeg installation. First-time vocal-tool/model setup can download several hundred MB. No live YouTube download or real Pi transfer was performed while testing this update; the file preparation, private password channel, remote import and recovery behavior were tested with local fixtures.
