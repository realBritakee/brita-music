import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { MiniKey } from '../shared/types.ts'
import type { Rect } from './windowState.ts'

export const MINI_SIZE = { width: 440, height: 88 }
/** Space left between the mini player and the screen edge when it opens for the first time. */
const MARGIN = 16
/** At least this much of the mini player must lie on a screen, or the remembered position is dropped. */
const REACHABLE_WIDTH = 120
const REACHABLE_HEIGHT = 40

export interface MiniPosition {
  x: number
  y: number
}

const KEYS: readonly string[] = ['previous', 'play-pause', 'next']

/** The mini player only passes on its three buttons; anything else from the page is ignored. */
export function isMiniKey(value: unknown): value is MiniKey {
  return typeof value === 'string' && KEYS.includes(value)
}

/** Bottom right corner of the screen area, where a small player stays out of the way. */
export function defaultMiniPosition(area: Rect): MiniPosition {
  return {
    x: Math.round(area.x + Math.max(0, area.width - MINI_SIZE.width - MARGIN)),
    y: Math.round(area.y + Math.max(0, area.height - MINI_SIZE.height - MARGIN)),
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function reachable(position: MiniPosition, screen: Rect): boolean {
  const across = Math.min(position.x + MINI_SIZE.width, screen.x + screen.width) - Math.max(position.x, screen.x)
  const down = Math.min(position.y + MINI_SIZE.height, screen.y + screen.height) - Math.max(position.y, screen.y)
  return across >= REACHABLE_WIDTH && down >= REACHABLE_HEIGHT
}

/** The stored position if the person could still grab the window there (the screen may be gone), else null. */
export function sanitizeMiniPosition(data: unknown, screens: Rect[]): MiniPosition | null {
  if (typeof data !== 'object' || data === null) return null
  const { x, y } = data as { x?: unknown; y?: unknown }
  if (!isCount(x) || !isCount(y)) return null
  const position = { x: Math.round(x), y: Math.round(y) }
  return screens.some((screen) => reachable(position, screen)) ? position : null
}

export function loadMiniPosition(file: string, screens: Rect[]): MiniPosition | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return sanitizeMiniPosition(JSON.parse(text), screens)
  } catch {
    // Only a remembered position: a damaged file just means the mini player opens in its usual corner.
    return null
  }
}

/** Synchronous, so it also finishes while the app is closing. Writes a temporary file first, like the other files. */
export function saveMiniPosition(file: string, position: MiniPosition): void {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(position), 'utf8')
  renameSync(temporary, file)
}
