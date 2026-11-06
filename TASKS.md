# TASKS

Status: NO ACTIVE TASK
Task: none. Version 0.2 (Steps 7 to 19) is finished and released as `dist/Brita-Music-Setup-0.2.0.exe`; see [Changelog.md](Changelog.md), entry 2026-11-06.
Updated: 2026-11-06

## Current step
None.

## Next
- [ ] Nothing planned. Chris decides what comes next (a GitHub release so updates work, or new features).

## Carried over (also in the changelog "Open")
- Unverified: a real headset unplug or plug-in, the real GitHub update path (first real proof needs a version after 0.2.0 over an installed 0.2.0), the Windows "protected your PC" screen, the mini player above a game in exclusive fullscreen, real mouse clicks on the new controls, a computer that sleeps while a timer runs.
- Flaky check (cause unknown): the "favorites" part of `tests/app-check.cjs` sometimes crashes in its right-click-menu check and passes on rerun.
- Defender once quarantined Electron's `ffmpeg.dll` (probably a false positive); if the app does not start after an install, check `ffmpeg.dll` and the Defender log first.
