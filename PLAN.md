# PLAN: Brita Music

Updated: 2026-11-05

## Goal
A simple Windows desktop app for Chris that plays his own music files and feels like Spotify: pick a folder once, and everything in it shows up, with subfolders as playlists.

## Version 1
- Add a music folder with a button. The app finds every music file inside it, however deep.
- Remove a music folder again with a button. This only makes the app forget the folder; the folder and its files on the PC stay untouched.
- Every folder directly inside the music folder is a playlist with the folder's name (`The White Buffalo` becomes the playlist "The White Buffalo").
- Picking a playlist plays only that playlist's songs.
- A "New playlist" button in the app creates a real new folder with that name inside the music folder.
- New folders and songs show up by themselves while the app is open, and at the next start.
- Song list with title, artist, album and length, read from the file. Cover picture in the player when the file or folder has one.
- Player: play and pause, next and previous, seek bar, volume and mute, shuffle, repeat (off, all, one).
- Search across the songs.
- Keyboard media keys and the space bar work.
- Remembers the folder, volume, shuffle, repeat and last song between starts.
- Looks like the DMZ site.

## Out of scope
- Streaming, accounts, internet features, downloads of covers or lyrics.
- Changing music files: the app only reads them. It never renames, moves, retags or deletes anything. The one thing it writes in the music folder is a new empty folder when Chris creates a playlist.
- Renaming or deleting playlists, or moving songs into them, from inside the app: that happens in Windows Explorer.
- Equalizer, crossfade, lyrics, queue editing, mobile or Mac versions.
- Light mode (the DMZ site has one, this app stays dark).

## Assumptions
- Only folders directly inside the music folder are playlists. `The White Buffalo/Album 1/song.mp3` belongs to the playlist "The White Buffalo", and "Album 1" is not a playlist of its own.
- Songs lying directly in the music folder, outside any subfolder, appear only under "All songs".
- More than one music folder can be added. Two playlists with the same name in different music folders become one.
- With more than one music folder, "New playlist" asks which one to create it in. A name that already exists or that Windows does not allow gives a clear message.
- A new playlist starts empty, and Chris copies songs into its folder in Explorer.
- A song without tags (the information stored inside a music file) uses its file name as title.
- A new playlist plays in file name order until Chris sorts or shuffles it.

## Technical decisions
- Electron (a kit that packs a web page into a desktop app): the DMZ site's look carries over directly, and it reads files on the PC. The tradeoff is an install size of about 100 to 200 MB.
- React, TypeScript, Zustand, lucide-react, plain CSS and Vite: the same tools as the DMZ site, so its look can be matched closely.
- `music-metadata` reads title, artist, album, length and cover from the files.
- `electron-builder` makes the installer.
- Look: copy the colours (greys, orange `#FF6F00`), square corners, uppercase Saira headings, buttons and badges from `DMZ/site/src/styles`, plus its local font files. The DMZ site itself is only read, never changed. A short `DESIGN.md` here records this, so it wins over the general Brita look.
- Song details are kept in a small file in the app's own data folder, so later starts are fast. Long lists draw only the visible rows.
- Files are served to the player only from folders Chris added.
- No git in this folder unless Chris asks (workspace rule: git only in folders that already have it).

## Risks and unknowns
- File types: Electron's built-in player should play MP3, M4A/AAC, FLAC, OGG, Opus and WAV. WMA and APE will not play, and ALAC (Apple lossless, in an `.m4a` file) may not. UNVERIFIED until tested in Step 1. Files that cannot play show a clear message and are skipped.
- Very large collections: the first scan may take a while, so it runs in the background with a progress line. Unmeasured until tested with Chris's real folder.
- Library versions seen on npm today: electron 45.2.3, music-metadata 12.3.4, electron-builder 26.18.0. Their exact calls get checked in current docs when added.
- `music-metadata` is built in the newer module style, which needs a particular way of loading in Electron. It is the most likely snag in Step 2.
- The installer is unsigned, so Windows may show a "protected your PC" warning on first install.
- Sound itself and how it feels can only be confirmed by Chris.

## Steps
Progress is not tracked here, only in `TASKS.md`.

### Step 1: First sound
- Goal: a window in the DMZ look where Chris adds a folder, sees playlists from its subfolders and song file names, and plays a song with play, pause and seek.
- Done when: Chris adds his music folder, `The White Buffalo` appears as a playlist, clicking a song plays it, and the common file types are tested.

### Step 2: Real song information
- Goal: title, artist, album, length and cover read from the files, and the library remembered between starts.
- Done when: the list shows real song details and covers, and after closing and reopening the app the library is there at once.

### Step 3: Full player controls
- Goal: next, previous, automatic next song, volume, mute, shuffle, repeat, media keys, space bar, and remembered settings. Also (added 2026-11-05, Chris said yes): a way to remove an added music folder.
- Done when: a playlist plays through by itself, every button works, and volume, shuffle, repeat and the last song survive a restart. Removing a music folder makes its songs and playlists disappear from the app, it stays gone after a restart, and the files on disk are still there.

### Step 4: Live folders and new playlists
- Goal: new, renamed or removed folders and songs update the app while it is open; a missing folder or drive gives a clear message; a "New playlist" button creates a real folder.
- Done when: creating a folder with a song in Windows Explorer makes the playlist appear in the app within a few seconds without a restart, and "New playlist" creates that folder in the music folder.

### Step 5: Search and Spotify feel
- Goal: search, a playlist header with cover and song count, sortable columns, the playing song highlighted, and a clear first-start screen.
- Done when: searching finds a song by title, artist or album, and Chris is happy with how it looks.

### Step 6: Installer
- Goal: an installer with a Brita Music icon, Start menu and desktop shortcut.
- Done when: Chris installs it, opens Brita Music from the Start menu without any developer tools, and plays a song.

# Version 0.2: more useful every day

Added 2026-11-05 after Chris's OK. Version 1 (Steps 1 to 6) is finished and installed.

## Goal (version 0.2)
Make the player more useful day to day: a settings screen, a visible queue, favorites, play history, sleep timer, tray and Windows media controls, drag and drop, and a mini player.

## Out of scope (version 0.2)
- Equalizer, crossfade, lyrics, light mode, streaming and accounts (still excluded).
- Renaming, retagging or deleting music files. Moving files is not built.
- Playlists that exist only inside the app (a favorites list is the one exception, and it lives in the app's own data).

## Assumptions (version 0.2)
- Close button quits the app by default; keeping the music playing in the tray is an option in settings (Chris, 2026-11-05).
- Dropping songs onto a playlist copies the file into the playlist folder and never moves or deletes anything. This is the only time the app writes a music file, besides the empty folder of "New playlist" (Chris, 2026-11-05).
- The mini player is included, as the last feature step (Chris, 2026-11-05).
- Favorites, play counts, recently played and the queue are kept in the app's own data folder, never inside the music folders. A renamed or moved song counts as a new song.
- New settings are added to the existing settings file without resetting the old values.
- Every step ends with unit tests and new checks in the app check, as before.

## Technical decisions (version 0.2)
- Same stack as version 1; no new library is planned. Tray, taskbar thumbnail buttons, window state, context menus and drag and drop use Electron's own features (names are checked in the current Electron docs when each step starts).
- Settings screen is a second page inside the same window, not a new window.
- Play history and favorites are saved in small JSON files like the library cache, written in the background.

## Risks and unknowns (version 0.2)
- Windows media overlay (song and cover in the volume flyout): Electron has no direct switch; the browser's `navigator.mediaSession` may show it, but it may fight with the media keys already registered by the app. UNVERIFIED, so Step 7 tests it before anything is built on it. If it fails, Step 16 only adds the taskbar buttons.
- Copying files by drag and drop is the first time the app writes a music file; it must refuse to overwrite and report clearly (Step 13).
- Tray, mini player and the overlay need Chris to try them by eye and ear; scripts can only check parts.
- A network share may not report changes (already known from Step 4).

### Step 7: Windows overlay test (trial)
- Goal: a small trial that sets the playing song, artist and cover through the browser's media session, to learn whether Windows shows it in the volume flyout and whether the media keys still work.
- Done when: Chris plays a song, opens the Windows volume flyout and sees title, artist and cover, and the keyboard media keys still work (or the result is "not possible" and Step 16 is cut down).

### Step 8: Settings screen
- Goal: a gear button opens a settings page: start paused or playing, how long a song plays before "previous" restarts it, default shuffle and repeat, the music folders (moved from the sidebar), and a note about the data folder. The window also remembers its size and position.
- Done when: each setting changes the behaviour after a restart, the music folders can still be added and removed from the page, and closing and reopening the app puts the window back where it was.

### Step 9: Queue view
- Goal: a "Playing next" panel showing the real play order (also when shuffled), where a song can be removed or moved to play next.
- Done when: with shuffle on, the panel shows the same order the songs then play in, removing a song skips it, and "play next" plays it right after the current song.

### Step 10: Song context menu
- Goal: right-click on a song gives Play next, Add to queue, Show in Explorer, Copy path, Go to artist and Go to album (fills the search box).
- Done when: each entry works on a real song, and Show in Explorer opens the folder with the file selected.

### Step 10b: Output device (added 2026-11-05, Chris asked)
- Goal: a button in the player bar (next to the volume) opens a short list of the PC's sound outputs (speakers, headphones, Bluetooth, HDMI). The first entry is "System default". Picking one plays Brita Music through it. The volume slider stays exactly as it is.
- Done when: with two outputs connected, picking the other one moves the sound to it while a song plays, the choice survives a restart, a device that is gone (unplugged headset) falls back to the system default with a short message, and the list updates when a device is plugged in or removed.
- Decisions (Chris, 2026-11-05): the volume slider stays as it is (no system volume control); "sound input" means the output device.
- Technical: no new library. The browser's own `navigator.mediaDevices.enumerateDevices()` lists outputs and `audio.setSinkId()` switches the player's output. The choice is saved by device id in the settings file (new field, old files keep working).
- Risks: (1) Chromium may hide the device names until the page has a permission; if so, the list shows "Output 1, Output 2" or Electron's permission handler is used for the name lookup. UNVERIFIED, tested first. (2) The song menu and the rest are not touched. (3) Only Chris can confirm the right device name and the sound by ear; the check can only test the list, the saved choice and the fallback.
- Out of scope: changing the Windows volume or the Windows default device, a microphone or any input, different devices per song.

### Step 11: Favorites
- Goal: a heart on each song and an automatic "Favorites" list in the sidebar.
- Done when: hearts survive a restart, the Favorites list plays like any list, and un-hearting removes the song from it.

### Step 12: Recently and most played
- Goal: two automatic lists, "Recently played" and "Most played", built from what is played (a song counts after half of it, or 30 seconds, has played).
- Done when: playing songs changes both lists, they survive a restart, and a skipped song does not count.

### Step 13: Drag and drop
- Goal: dropping a folder on the window adds it as a music folder; dropping songs onto a playlist in the sidebar copies them into that playlist's folder.
- Done when: a dropped folder appears as a music folder, dropped songs appear in the playlist, nothing is moved or overwritten, and a name that already exists gives a clear message.

### Step 14: Sleep timer
- Goal: "Stop after 15, 30, 60 minutes or after this song", with the time left shown in the player bar.
- Done when: playback fades or stops at the chosen time, the timer can be cancelled, and it is gone after a restart.

### Step 15: Tray
- Goal: an option "Keep playing in the tray when the window is closed" (off by default); the tray icon has play/pause, next and Quit, and a click opens the window.
- Done when: with the option on, closing the window keeps the music playing and the tray opens it again; with the option off, closing quits as before.

### Step 16: Windows overlay and taskbar buttons
- Goal: the final overlay from Step 7 (if it worked) and previous, play/pause and next buttons on the taskbar thumbnail.
- Done when: the buttons work and the flyout shows the playing song, or Step 7 said it is not possible and only the buttons are done.

### Step 17: Mini player
- Goal: a small always-on-top bar with cover, title and the main buttons, opened from the player bar and the tray.
- Done when: it shows and controls the song that plays in the main window, and closing it does not stop the music.

### Step 18: Auto update (added 2026-11-05, Chris asked)
- Goal: when the installed program starts, it looks for a newer version on GitHub Releases. If there is one, a small message asks "Version X is available. Download and restart?" with "Update" and "Later". Nothing downloads or installs without his click. The settings page shows the current version and a "Check for updates" button.
- Done when: a test run against a fake newer version served from a local folder finds it, shows the message, downloads it with a progress line and offers the restart; "Later" and no internet do nothing and show no error at start; a check that fails shows a plain message only when Chris pressed the button.
- Decisions (Chris, 2026-11-05): updates come from GitHub Releases; ask first.
- Technical: `electron-updater` (the update library made for electron-builder; the one new dependency) with the `github` provider. `electron-builder` gets a `publish` entry (GitHub owner and repository) and writes `latest.yml` and a `.blockmap` next to the installer. The check runs only in the installed program, never in development. The exact calls get checked in the installed package when added (Context7 is down on this PC).
- How a release works afterwards: Chris raises the version in `package.json`, I run the build, and he uploads the installer, the `.blockmap` and `latest.yml` to a new GitHub release whose tag matches the version. I never upload anything for him.
- Out of scope: silent or forced updates, code signing, beta channels, uploading by the app or by me.
- Risks: (1) The installed version 0.1.0 has no updater, so Chris installs 0.2.0 by hand once; the first real update proof is a later version over 0.2.0. (2) A private repository cannot be read by the app without a secret inside it, so the releases must be public (a repository with only releases and no source is enough). (3) The installer is unsigned: Windows may still warn on install; the update itself is checked by a fingerprint in `latest.yml`. UNVERIFIED until tested. (4) On 2026-11-05 Windows Defender quarantined Electron's `ffmpeg.dll` (`Trojan:Win32/Posilod.EB!cl`, a cloud detection, probably a false positive) in the installed app and the dev copy, which stopped the app from starting. Every installer and update contains that file, so other PCs may hit the same thing. Chris reports it to Microsoft as not malware; code signing is out of scope here but would help.

### Step 19: Release 0.2.0
- Goal: version 0.2.0, a new installer, a review of the changes and the changelog.
- Done when: Chris installs it over the old version, his library and settings are still there, and the new features work.
