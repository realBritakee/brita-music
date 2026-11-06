# Changelog

All notable changes to this project. Newest first.

## 2026-11-06 - Version 0.2.1 test build and first GitHub push

### Added
- [README.md](README.md) and [.gitignore](.gitignore) (leaves out `node_modules/`, `out/`, `dist/`, logs, `.env` files); the project was pushed to https://github.com/realBritakee/brita-music as commit `35a2ac9` on `main` (82 files, no secrets found). The repository had no commit before, so GitHub could not create a release.
- Test build `Brita-Music-Setup-0.2.1.exe` with `.blockmap` and `latest.yml` in `dist/build-0.2.1`, only to test the updater over an installed 0.2.0; the program is the same as 0.2.0.
- Safe copy of the 0.2.0 release files in `dist/release-0.2.0`, because a new build overwrites `latest.yml`.

### Changed
- [package.json](package.json) version is 0.2.1 (not committed yet).

### Did not work
- `npm run dist` failed twice with `EBUSY` on `dist\win-unpacked\resources\app.asar`; no Brita Music process held it and the cause is unknown (unverified). Building with `electron-builder -c.directories.output=dist/build-0.2.1` worked.

### Open
- Release `v0.2.0` is not published yet (Chris uploads it). The updater test (publish `v0.2.1`, restart 0.2.0, press Update) has not been run; the real GitHub update path is still unverified.
- `dist/win-unpacked` may stay locked; a later `npm run dist` may fail the same way.

## 2026-11-06 - Brita Music version 0.2.0, steps 7 to 19

### Added
- Settings page (gear in the sidebar): start paused or continue, how long before "previous" restarts a song, shuffle and repeat at start, music folders (moved here), data folder note; the window remembers size, position and maximized state ([Settings.tsx](src/renderer/src/Settings.tsx), [windowState.ts](src/main/windowState.ts)).
- Queue panel "Playing next" with the real play order, "Play next" and "Remove" per row ([queue.ts](src/renderer/src/queue.ts)).
- Song context menu: Play next, Add to queue, Show in Explorer, Copy path, Go to artist, Go to album ([songActions.ts](src/main/songActions.ts)).
- Output device list next to the volume, saved, falls back to the system default when a device is gone ([output.ts](src/renderer/src/output.ts)).
- Favorites (heart on rows, player bar and menu, a "Favorites" list), "Recently played" and "Most played" lists; saved in the data folder, never in the music folders ([favorites.ts](src/renderer/src/favorites.ts), [history.ts](src/renderer/src/history.ts)).
- Drag and drop: a dropped folder becomes a music folder; songs dropped on a playlist are copied into its folder and never overwrite ([drop.ts](src/main/drop.ts)).
- Sleep timer (moon button): 15, 30, 60 minutes or after this song, 3 second fade, time left in the bar ([sleep.ts](src/renderer/src/sleep.ts)).
- Tray: option "Keep playing in the tray" (off by default), icon with song, Open, Play/Pause, Next, Quit; a second start opens the hidden window ([tray.ts](src/main/tray.ts)).
- Windows media: song, artist and cover in the volume flyout; previous, play/pause and next on the taskbar thumbnail ([thumbar.ts](src/main/thumbar.ts)).
- Mini player: small always-on-top bar with cover, title and main buttons, opened from the player bar or the tray ([miniPlayer.ts](src/main/miniPlayer.ts), [Mini.tsx](src/renderer/src/Mini.tsx)).
- Auto update: at start the installed program asks GitHub Releases (realBritakee/brita-music) and offers "Update" or "Later"; settings show the version and "Check for updates" ([updates.ts](src/main/updates.ts)). New dependency: `electron-updater`.
- Installer `dist/Brita-Music-Setup-0.2.0.exe` (113.4 MB, unsigned) with `.blockmap` and `latest.yml`; version in [package.json](package.json) is 0.2.0.
- Tests: 129 unit tests (17 files, all pass) and the app check, last run on both starts with 359 + 52 PASS lines and 0 FAIL ([app-check.cjs](tests/app-check.cjs)).

### Changed
- The right column of the player bar keeps a minimum width so buttons do not run over the seek bar at 800 px.
- The installer is named with the version; `dist` never publishes anything.

### Fixed
- Taskbar buttons did nothing: Windows refuses `setThumbarButtons` when a button has `flags: ['enabled']`; the flag is now left out (checked by the app check).
- The app check missed the mini window because its watched `BrowserWindow` subclass hides it from `getAllWindows()`; it now keeps its own list.
- The app stopped starting after Windows Defender quarantined Electron's `ffmpeg.dll` (cloud detection `Trojan:Win32/Posilod.EB!cl`, probably a false positive); the file was restored by allowing it.

### Did not work
- The first 0.2.0 installer (00:07) was built before Steps 11 to 17, so it lacked favorites, history, drag and drop, sleep timer, tray, taskbar buttons and the mini player. The notes wrongly said it only lacked Steps 16 and 17. Found in the Step 19 review by looking inside its `app.asar`; rebuilt at 04:42.
- Context7 was not available for library calls; names were read from the installed packages.
- The "favorites" part of the app check crashed in 3 of about 8 runs (right-click menu, "Script failed to execute"), cause unknown (unverified); it passed in the final runs.

### Learned
- Compare an installer's build time with the source and look inside its packed app before saying what it contains. Added to the global Lessons file.

### Open
- Chris installed the rebuilt installer over his copy and confirmed "Works, continue" (2026-11-06). Not proven: the installer's Windows "protected your PC" screen, the app check against the packed build.
- Unverified: a real headset unplug or plug-in, the real GitHub update path (no release exists; the first real proof needs a version after 0.2.0 over an installed 0.2.0), whether the mini player stays above a game in exclusive fullscreen, real mouse clicks and dragging on the new controls (scripted only), a computer that sleeps while a timer runs.
- Next: reset [TASKS.md](TASKS.md); a GitHub release (Chris uploads the installer, `.blockmap` and `latest.yml`) when he wants updates to work.

## 2026-11-05 - Brita Music version 0.1.0, steps 1 to 6

### Added
- Desktop player (Electron, React, TypeScript, Zustand) in the DMZ site's look ([DESIGN.md](DESIGN.md), [theme.css](src/renderer/src/styles/theme.css)).
- Music folders: add and remove (removing only makes the app forget the folder), every folder inside is a playlist, songs lying loose show under "All songs" ([scan.ts](src/main/scan.ts), [playlist.ts](src/main/playlist.ts)).
- Song details from tags (MP3, FLAC, Opus) with the file name as fallback, covers from inside a song or a `cover.png` in the folder, library remembered between starts ([tags.ts](src/main/tags.ts), [covers.ts](src/main/covers.ts), [persist.ts](src/main/persist.ts)).
- Player: play and pause, seek, next and previous, autoplay that skips unplayable files, shuffle, repeat off/all/one, volume and mute, space bar, the four media keys, remembered settings and last song ([store.ts](src/renderer/src/store.ts), [media.ts](src/main/media.ts)).
- Live folders: new, renamed and deleted folders and songs appear by themselves; a missing folder or drive gives a message and comes back by itself ([watch.ts](src/main/watch.ts)). "New playlist" makes a real folder.
- Search (title, artist, album, ignoring case and accents), sortable columns, playlist header with cover and song count, speaker icon on the playing song, Ctrl+F and Escape, a clearer first-start screen ([search.ts](src/renderer/src/search.ts), [App.tsx](src/renderer/src/App.tsx)).
- Windows installer: `npm run dist` makes `dist/Brita Music Setup 0.1.0.exe` (107.8 MB, unsigned, one click, per user, Start menu and desktop shortcut). Icon: orange square with the music note ([build/icon.ico](build/icon.ico)).
- Tests: 48 unit tests ([tests](tests)) and a self-driving app check, `npm run test:app`, 154 checks over two starts on generated songs ([app-check.cjs](tests/app-check.cjs)).

### Changed
- React, Zustand, lucide-react and their types moved to `devDependencies`; they are already inside the built page, so the package carries only `music-metadata` and its 12 helper packages ([package.json](package.json)).
- `tests/app-check.cjs` can run against the packed program with `BRITA_MAIN`, and switches off Chromium's window-occlusion detection.

### Fixed
- Opus and OGG files showed no length: those formats only tell it at the end of the file, so the reader now follows them to the end for `.ogg`, `.oga` and `.opus` only (found by the app check, verified by it).
- The app check failed on lazy covers when its window lay behind other windows: the page was "hidden" (measured), so occlusion detection is switched off in the check. Only the test changed, not the app.

### Did not work
- Showing the songs of a missing folder from memory: it would offer songs that cannot play, so they are hidden.
- `net.fetch` for playback: Electron does not promise byte ranges, which seeking needs, so `media.ts` answers ranges itself.
- Reading the length of every file (`duration: true`) and reading every embedded cover during the first scan: both make the scan slow, so they are limited as described in [TASKS.md](TASKS.md) "Ruled out".
- Context7 rejected its API key on this PC, and the electron.build docs site returned an empty page; option names were read from electronjs.org, the installed type files and `app-builder-lib/scheme.json`.
- An icon script that opened a second window with a `data:` address failed with ERR_FAILED; it now draws everything in one window.
- A run with `BRITA_SCREENSHOT` fails the restart check by design: the screenshot step plays another song after the settings are saved. Judge restarts on a run without it.
- The app check's cleanup threw EPERM because Windows still locked the app's data folder; cleanup is now best-effort and a stuck run is stopped by its process ID.

### Learned
- Measure what the window reports (page visibility) before blaming code for a test that fails only sometimes.
- Read option names from the installed package instead of a docs site that needs JavaScript.
- Both are in the global Lessons file.

### Open
- Chris has not installed or played with the app yet; the installer itself was not run (unverified): Start menu and desktop shortcuts, the "Windows protected your PC" screen for an unsigned installer, the uninstaller.
- Unverified with real music: speed of the first scan, covers and lengths of a large collection, VBR MP3 lengths, a real physical media key press, a real unplugged drive, a music folder on a network share (Windows may not report changes there; they would show after a restart), OGG with Vorbis inside, ALAC, and a cover stored as JPEG inside a file.
- Chris still decides whether the look of the Step 5 screens is right (the plan's "done when").
- Next: reset [TASKS.md](TASKS.md) after Chris's install.
