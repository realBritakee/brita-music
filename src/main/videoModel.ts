// How the app reads and controls a video that plays in the Download page's browser view.
// The app puts no code into the page for good: it runs a short script now and then (to read the video) or on a button press
// (to control it). The pieces here are plain strings and functions, so they can be tested without Electron.

import type { VideoCommand, VideoState } from '../shared/types.ts'

/**
 * Finds the video the person watches. On YouTube only watch and shorts pages count (the previews on the start page
 * also contain videos); on other sites it is the first video that has loaded.
 */
const FIND_VIDEO = `
  const host = location.hostname;
  const onYoutube = host === 'youtube.com' || host.endsWith('.youtube.com');
  const watchPage = location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  const v = onYoutube && !watchPage ? null
    : (onYoutube ? document.querySelector('video.html5-main-video') : null) ?? [...document.querySelectorAll('video')].find((item) => item.readyState >= 1);
  const shown = (element) => element !== null && element.offsetParent !== null && getComputedStyle(element).display !== 'none';
`

/** Reads the video: title, state, time, volume and whether YouTube offers next and previous. Gives null when there is no video. */
export const READ_VIDEO = `(() => {${FIND_VIDEO}
  if (!v) return null;
  const title = document.title.replace(/^\\(\\d+\\)\\s*/, '').replace(/\\s*-\\s*YouTube$/, '').trim();
  return {
    title: title === '' ? host : title,
    playing: !v.paused && !v.ended,
    time: v.currentTime || 0,
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    volume: v.volume,
    muted: v.muted,
    canNext: onYoutube && shown(document.querySelector('.ytp-next-button')),
    canPrevious: onYoutube && shown(document.querySelector('.ytp-prev-button')),
  };
})()`

/** Turns whatever the page answered into a valid state; anything else means "no video". */
export function parseVideoState(value: unknown): VideoState | null {
  if (typeof value !== 'object' || value === null) return null
  const { title, playing, time, duration, volume, muted, canNext, canPrevious } = value as Record<string, unknown>
  if (typeof title !== 'string') return null
  const number = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)
  return {
    title: title.slice(0, 300),
    playing: playing === true,
    time: Math.max(number(time, 0), 0),
    duration: Math.max(number(duration, 0), 0),
    volume: Math.min(Math.max(number(volume, 1), 0), 1),
    muted: muted === true,
    canNext: canNext === true,
    canPrevious: canPrevious === true,
  }
}

/** Reads a command from the window's message; null when it is not one of the known commands. */
export function sanitizeVideoCommand(value: unknown): VideoCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const { type, seconds, volume } = value as Record<string, unknown>
  if (type === 'toggle' || type === 'mute' || type === 'next' || type === 'previous') return { type }
  if (type === 'seek' && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return { type, seconds }
  if (type === 'volume' && typeof volume === 'number' && Number.isFinite(volume)) return { type, volume: Math.min(Math.max(volume, 0), 1) }
  if (type === 'pause') return { type }
  return null
}

/** The script that carries out a command. It answers true when it found a video. */
export function commandScript(command: VideoCommand): string {
  let action: string
  switch (command.type) {
    case 'toggle':
      action = 'if (v.paused) { v.play(); } else { v.pause(); }'
      break
    case 'pause':
      action = 'v.pause();'
      break
    case 'seek':
      action = `v.currentTime = ${command.seconds};`
      break
    case 'volume':
      action = `v.volume = ${command.volume}; v.muted = ${command.volume === 0};`
      break
    case 'mute':
      action = 'v.muted = !v.muted;'
      break
    case 'next':
      action = "const button = document.querySelector('.ytp-next-button'); if (shown(button)) button.click();"
      break
    case 'previous':
      action = "const button = document.querySelector('.ytp-prev-button'); if (shown(button)) { button.click(); } else { v.currentTime = 0; }"
      break
  }
  return `(() => {${FIND_VIDEO} if (!v) return false; ${action} return true; })()`
}
