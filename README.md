# Brita Music

A simple Windows desktop player for your own music files. Pick a folder once and everything in it shows up. Every folder inside it is a playlist.

## Download

Get the installer from the [Releases](https://github.com/realBritakee/brita-music/releases) page: `Brita-Music-Setup-<version>.exe`. The installer is not code signed, so Windows may show "Windows protected your PC" on first install.

## Features

- Add or remove music folders; subfolders become playlists, and new files appear by themselves.
- Song details and covers read from the files (MP3, M4A, FLAC, OGG, Opus, WAV).
- Play, pause, next, previous, seek, volume, shuffle, repeat, search, keyboard media keys.
- Queue panel, song menu, favorites, recently and most played lists.
- Choice of sound output, sleep timer, drag and drop of folders and songs.
- Tray mode, taskbar buttons, mini player.
- Update check against GitHub Releases (asks before it downloads anything).

The app only reads your music files. It never renames, retags or deletes them. It writes into a music folder only when you create a playlist (an empty folder) or drop songs on a playlist (a copy).

## Develop

Needs Node.js and Windows.

```bash
npm install
npm run dev        # run in development
npm test           # unit tests
npm run test:app   # self-driving app check
npm run dist       # build the installer into dist/
```

Built with Electron, React, TypeScript, Zustand and `music-metadata`. The look follows [DESIGN.md](DESIGN.md); plans and history are in [PLAN.md](PLAN.md) and [Changelog.md](Changelog.md).
