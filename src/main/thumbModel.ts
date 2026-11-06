import type { PlaybackReport } from '../shared/types.ts'

/** What a taskbar thumbnail button does when pressed. */
export type ThumbAction = 'previous' | 'play-pause' | 'next'

export type Glyph = 'previous' | 'play' | 'pause' | 'next'

export interface ThumbSpec {
  action: ThumbAction
  glyph: Glyph
  tooltip: string
  /** Buttons wait until a song is loaded. */
  enabled: boolean
}

/**
 * The three buttons on the taskbar thumbnail: always previous, play or pause, next, in this order.
 * The count never changes, because Windows updates buttons in place only while the count stays the same.
 */
export function thumbSpecs(report: PlaybackReport): ThumbSpec[] {
  const enabled = report.song !== null
  return [
    { action: 'previous', glyph: 'previous', tooltip: 'Previous', enabled },
    { action: 'play-pause', glyph: report.playing ? 'pause' : 'play', tooltip: report.playing ? 'Pause' : 'Play', enabled },
    { action: 'next', glyph: 'next', tooltip: 'Next', enabled },
  ]
}

/** Two lists of buttons with the same signature look the same, so the taskbar need not be touched. */
export function thumbSignature(specs: readonly ThumbSpec[]): string {
  return specs.map((spec) => `${spec.action}:${spec.glyph}:${spec.enabled ? 1 : 0}`).join('|')
}
