import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_RESTART_AFTER, RESTART_CHOICES } from '../shared/choices.ts'
import type { Library, Play, Settings } from '../shared/types.ts'

/** What was true about a file when its details were read. A changed stamp means: read again. */
export interface Stamp {
  size: number
  mtimeMs: number
}

export interface LibraryCache {
  version: number
  library: Library
  /** Stamps by lower-case song path. */
  stamps: Record<string, Stamp>
}

export const CACHE_VERSION = 1

async function readJson(file: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    // These files are only remembered facts. A damaged one is dropped and rebuilt from the music folders.
    return null
  }
}

/** Writes to a temporary file first, so a crash in the middle never leaves a half-written file. */
async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify(data), 'utf8')
  await rename(temporary, file)
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export async function loadFolders(file: string): Promise<string[]> {
  const data = (await readJson(file)) as { folders?: unknown } | null
  return data !== null && isStringList(data?.folders) ? data.folders : []
}

export function saveFolders(file: string, folders: string[]): Promise<void> {
  return writeJson(file, { folders })
}

/** Turns whatever was stored (or sent) into a list of song paths: only text, no empty entries, each path once. */
export function sanitizeFavorites(data: unknown): string[] {
  const raw = (typeof data === 'object' && data !== null ? (data as { songs?: unknown }).songs : null) ?? []
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((item): item is string => typeof item === 'string' && item !== ''))]
}

export async function loadFavorites(file: string): Promise<string[]> {
  return sanitizeFavorites(await readJson(file))
}

export function saveFavorites(file: string, songs: string[]): Promise<void> {
  return writeJson(file, { songs })
}

/**
 * Turns whatever was stored (or sent) into a list of plays: a text path, a whole number of plays of at least 1 and a
 * time. Anything else is dropped; a song that appears twice keeps its first entry.
 */
export function sanitizePlays(data: unknown): Play[] {
  const raw = (typeof data === 'object' && data !== null ? (data as { plays?: unknown }).plays : null) ?? []
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const plays: Play[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { path: file, count, last } = item as Record<string, unknown>
    if (typeof file !== 'string' || file === '' || seen.has(file)) continue
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) continue
    if (typeof last !== 'number' || !Number.isFinite(last) || last < 0) continue
    seen.add(file)
    plays.push({ path: file, count, last })
  }
  return plays
}

export async function loadHistory(file: string): Promise<Play[]> {
  return sanitizePlays(await readJson(file))
}

export function saveHistory(file: string, plays: Play[]): Promise<void> {
  return writeJson(file, { plays })
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  lastSong: null,
  outputDevice: '',
  startPlaying: false,
  restartAfter: DEFAULT_RESTART_AFTER,
  shuffleAtStart: 'remember',
  repeatAtStart: 'remember',
  closeToTray: false,
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback
}

/**
 * Turns whatever was stored (or sent) into valid settings; every wrong or missing value falls back to its default.
 * A file from an older version has no choices yet, so it simply gets the defaults for them.
 */
export function sanitizeSettings(data: unknown): Settings {
  const raw = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.min(Math.max(raw.volume, 0), 1) : DEFAULT_SETTINGS.volume
  const restartAfter = RESTART_CHOICES.find((seconds) => seconds === raw.restartAfter) ?? DEFAULT_RESTART_AFTER
  return {
    volume,
    muted: raw.muted === true,
    shuffle: raw.shuffle === true,
    repeat: raw.repeat === 'all' || raw.repeat === 'one' ? raw.repeat : 'off',
    lastSong: typeof raw.lastSong === 'string' && raw.lastSong !== '' ? raw.lastSong : null,
    outputDevice: typeof raw.outputDevice === 'string' ? raw.outputDevice : '',
    startPlaying: raw.startPlaying === true,
    restartAfter,
    shuffleAtStart: oneOf(raw.shuffleAtStart, ['remember', 'on', 'off'], 'remember'),
    repeatAtStart: oneOf(raw.repeatAtStart, ['remember', 'off', 'all', 'one'], 'remember'),
    closeToTray: raw.closeToTray === true,
  }
}

export async function loadSettings(file: string): Promise<Settings> {
  return sanitizeSettings(await readJson(file))
}

export function saveSettings(file: string, settings: Settings): Promise<void> {
  return writeJson(file, settings)
}

export async function loadCache(file: string): Promise<LibraryCache | null> {
  const data = (await readJson(file)) as Partial<LibraryCache> | null
  if (data === null || data.version !== CACHE_VERSION) return null
  if (typeof data.library !== 'object' || data.library === null || !Array.isArray(data.library.songs)) return null
  if (typeof data.stamps !== 'object' || data.stamps === null) return null
  // A library saved by an older version has no list of missing folders.
  data.library.missing = isStringList(data.library.missing) ? data.library.missing : []
  return data as LibraryCache
}

export function saveCache(file: string, library: Library, stamps: Record<string, Stamp>): Promise<void> {
  const cache: LibraryCache = { version: CACHE_VERSION, library, stamps }
  return writeJson(file, cache)
}
