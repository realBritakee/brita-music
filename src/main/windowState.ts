import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where the window was when the app closed. Without x and y, Windows places it. */
export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export const MIN_WIDTH = 800
export const MIN_HEIGHT = 500
export const DEFAULT_SIZE = { width: 1280, height: 800 }
/** At least this much of the window's top edge must lie on a screen, or the position is dropped. */
const REACHABLE_WIDTH = 120
const REACHABLE_HEIGHT = 40
const MAX_SIZE = 10000

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** The screen whose work area holds enough of the window's top edge for the person to grab it, or null. */
function screenFor(x: number, y: number, width: number, screens: Rect[]): Rect | null {
  return screens.find((screen) => {
    const across = Math.min(x + width, screen.x + screen.width) - Math.max(x, screen.x)
    const down = screen.y + screen.height - Math.max(y, screen.y)
    return across >= REACHABLE_WIDTH && down >= REACHABLE_HEIGHT && y >= screen.y - 10
  }) ?? null
}

/**
 * Turns what was stored into a window state that fits the screens that exist now (the second screen may be gone).
 * Returns null when nothing usable was stored.
 */
export function sanitizeWindowState(data: unknown, screens: Rect[]): WindowState | null {
  if (typeof data !== 'object' || data === null) return null
  const raw = data as Record<string, unknown>
  if (!isCount(raw.width) || !isCount(raw.height)) return null

  let width = Math.min(Math.max(Math.round(raw.width), MIN_WIDTH), MAX_SIZE)
  let height = Math.min(Math.max(Math.round(raw.height), MIN_HEIGHT), MAX_SIZE)
  const maximized = raw.maximized === true

  const x = isCount(raw.x) ? Math.round(raw.x) : null
  const y = isCount(raw.y) ? Math.round(raw.y) : null
  const screen = x !== null && y !== null ? screenFor(x, y, width, screens) : null
  const fit = screen ?? screens[0]
  if (fit !== undefined) {
    width = Math.max(Math.min(width, fit.width), Math.min(MIN_WIDTH, fit.width))
    height = Math.max(Math.min(height, fit.height), Math.min(MIN_HEIGHT, fit.height))
  }
  if (screen === null || x === null || y === null) return { width, height, maximized }
  return { width, height, x, y, maximized }
}

export function loadWindowState(file: string, screens: Rect[]): WindowState | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return sanitizeWindowState(JSON.parse(text), screens)
  } catch {
    // Only a remembered position: a damaged file just means the window opens in its usual place.
    return null
  }
}

/** Synchronous, so it also finishes while the app is closing. Writes a temporary file first, like the other files. */
export function saveWindowState(file: string, state: WindowState): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(state), 'utf8')
  renameSync(temporary, file)
}
