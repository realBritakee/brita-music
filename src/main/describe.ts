import { stat } from 'node:fs/promises'
import type { Details, Progress, Song } from '../shared/types.ts'
import type { Stamp } from './persist.ts'
import { readDetails } from './tags.ts'

export interface Known {
  details: Details
  stamp: Stamp
}

/** Details read earlier, by lower-case song path. */
export type KnownMap = Map<string, Known>

export interface DescribeHooks {
  /**
   * Called once the remembered details are applied, then now and then while new ones are read.
   * Progress is null when there is nothing to read. `known` is what has been read so far.
   */
  onSnapshot(songs: Song[], progress: Progress | null, known: KnownMap): void
  /** Return true to stop early, for example because a newer refresh has started. */
  isCancelled(): boolean
  read?(filePath: string): Promise<Details>
  /** Smallest wait between two snapshots while reading. */
  snapshotEveryMs?: number
}

const STAT_AT_ONCE = 64
const READ_AT_ONCE = 8

async function stampOf(filePath: string): Promise<Stamp | null> {
  try {
    const info = await stat(filePath)
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

function sameStamp(a: Stamp, b: Stamp): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs
}

/** Runs work on a list with a limited number of jobs at the same time. */
async function inBatches<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Fills in title, artist, album and length. Songs whose file did not change since the last time use the
 * remembered details; only new or changed files are read. Returns the songs and what is now known.
 */
export async function describeSongs(
  songs: Song[],
  previous: KnownMap,
  hooks: DescribeHooks,
): Promise<{ songs: Song[]; known: KnownMap; /** How many songs had to be read. */ read: number }> {
  const read = hooks.read ?? readDetails
  const every = hooks.snapshotEveryMs ?? 2000
  const result = songs.slice()
  const known: KnownMap = new Map()
  const stamps: Array<Stamp | null> = new Array(songs.length).fill(null)
  const pending: number[] = []

  await inBatches(songs.map((_, index) => index), STAT_AT_ONCE, async (index) => {
    stamps[index] = await stampOf(songs[index].path)
  })

  songs.forEach((song, index) => {
    const stamp = stamps[index]
    const id = song.path.toLowerCase()
    const before = previous.get(id)
    if (stamp !== null && before !== undefined && sameStamp(before.stamp, stamp)) {
      result[index] = { ...song, ...before.details }
      known.set(id, before)
    } else {
      pending.push(index)
    }
  })

  hooks.onSnapshot(result.slice(), pending.length > 0 ? { done: 0, total: pending.length } : null, known)

  let done = 0
  let lastSnapshot = Date.now()
  await inBatches(pending, READ_AT_ONCE, async (index) => {
    if (hooks.isCancelled()) return
    const song = songs[index]
    const details = await read(song.path)
    result[index] = { ...song, ...details }
    const stamp = stamps[index]
    if (stamp !== null) known.set(song.path.toLowerCase(), { details, stamp })
    done++
    if (Date.now() - lastSnapshot >= every && done < pending.length) {
      lastSnapshot = Date.now()
      hooks.onSnapshot(result.slice(), { done, total: pending.length }, known)
    }
  })

  return { songs: result, known, read: pending.length }
}
