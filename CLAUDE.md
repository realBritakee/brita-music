# CLAUDE.md

Brita Music: a Windows desktop player (Electron, React, TypeScript, Zustand, plain CSS, Vite via electron-vite) for the user's own music files. Music folders are added once; every folder directly inside one is a playlist.

## Commands

- `npm run dev`: run in development.
- `npm run build`: `tsc --noEmit` and `electron-vite build` into `out/`.
- `npm test`: unit tests (`node --test tests/*.test.ts`). Run files one by one with a `timeout` if it seems to hang.
- `npm run test:app`: build, then the self-driving Electron check `tests/app-check.cjs` (two starts). It drives a real window on generated songs; do not run it while the user needs the screen.
- `npm run test:updates`: update check against a fake local server.
- `npm run dist`: build the installer into `dist/` (never publishes). Raise `version` in `package.json` first. Upload of the installer, `.blockmap` and `latest.yml` to a GitHub release (tag `v<version>`) is done by the user.

## Layout

- `src/main/`: Electron main process (scanning, watching, tags, covers, media server with byte ranges, persistence, tray, mini player, taskbar buttons, drag and drop, updates).
- `src/preload/index.ts`: the `window.brita` bridge.
- `src/shared/`: types and choices used by both sides.
- `src/renderer/`: React UI. State lives in `src/renderer/src/store.ts` (Zustand); the mini player is a separate page (`mini.html`, `Mini.tsx`) that never loads the music code.
- `tests/`: unit tests and the app check.
- `build/`: installer icon.

## Rules

- The app only reads music files. It writes into a music folder only to create an empty playlist folder or to copy dropped songs (never overwriting).
- App data (library cache, favorites, history, settings, window and mini player position) goes in the app's own data folder, never in music folders.
- Files are served to the player only from folders the user added.
- Look: dark only, orange accent `#FF6F00`, square corners, Saira font bundled locally (no external hosts), Lucide icons. Tokens are in `src/renderer/src/styles/theme.css`.
- Small functions, early returns, no silent catches, no new dependencies without asking.
- Windows: write files as UTF-8 without BOM; check an Electron main-process API's signature in `electron.d.ts` before use (several return promises). `setThumbarButtons` must not get `flags: ['enabled']`.
- Commit messages are plain, with no co-author line.
