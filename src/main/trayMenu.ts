import type { PlaybackReport } from '../shared/types.ts'

/** What a tray menu entry does when chosen. */
export type TrayAction = 'open' | 'mini' | 'play-pause' | 'next' | 'quit'

export type TrayEntry =
  | { kind: 'separator' }
  | { kind: 'item'; label: string; enabled: boolean; action: TrayAction | null }

export const NO_SONG: PlaybackReport = { playing: false, song: null }

/** Windows cuts a tray tooltip at 127 characters. */
const TOOLTIP_LIMIT = 127

/** Turns whatever the window sent into a valid report; anything else means "nothing is loaded". */
export function sanitizeReport(data: unknown): PlaybackReport {
  if (typeof data !== 'object' || data === null) return NO_SONG
  const { playing, song } = data as { playing?: unknown; song?: unknown }
  if (typeof song !== 'object' || song === null) return NO_SONG
  const { title, artist, path } = song as { title?: unknown; artist?: unknown; path?: unknown }
  if (typeof title !== 'string') return NO_SONG
  return {
    playing: playing === true,
    song: { title, artist: typeof artist === 'string' ? artist : '', path: typeof path === 'string' ? path : '' },
  }
}

function songLine(report: PlaybackReport): string {
  if (report.song === null) return ''
  const { title, artist } = report.song
  return artist === '' ? title : `${title} - ${artist}`
}

/** The text that appears when the mouse rests on the tray icon. */
export function trayTooltip(report: PlaybackReport): string {
  const line = songLine(report)
  const text = line === '' ? 'Brita Music' : `Brita Music: ${line}`
  return text.length > TOOLTIP_LIMIT ? `${text.slice(0, TOOLTIP_LIMIT - 1)}…` : text
}

/** The tray menu: the playing song, then Open, Mini player, Play or Pause, Next and Quit. Play and Next wait for a loaded song. */
export function trayEntries(report: PlaybackReport): TrayEntry[] {
  const hasSong = report.song !== null
  const line = songLine(report)
  const entries: TrayEntry[] = []
  if (line !== '') {
    entries.push({ kind: 'item', label: line, enabled: false, action: null }, { kind: 'separator' })
  }
  entries.push(
    { kind: 'item', label: 'Open Brita Music', enabled: true, action: 'open' },
    { kind: 'item', label: 'Mini player', enabled: true, action: 'mini' },
    { kind: 'separator' },
    { kind: 'item', label: report.playing ? 'Pause' : 'Play', enabled: hasSong, action: 'play-pause' },
    { kind: 'item', label: 'Next', enabled: hasSong, action: 'next' },
    { kind: 'separator' },
    { kind: 'item', label: 'Quit', enabled: true, action: 'quit' },
  )
  return entries
}
