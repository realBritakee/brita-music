import type { Play, Song } from '../../shared/types'

/** The view keys of the two automatic lists. A colon cannot be part of a Windows folder name, so no playlist can have these keys. */
export const RECENT_VIEW = ':recent'
export const MOST_VIEW = ':most'

/** Each of the two lists shows at most this many songs. */
export const LIST_SIZE = 50

/** A play counts after this many seconds, or after half of a shorter song. */
const COUNT_AFTER_SECONDS = 30

/** Playing time that moves forward by more than this between two updates is a jump (a seek), not listening. */
const LONGEST_STEP_SECONDS = 3

/** How many seconds of a song must really be heard before it counts as played. An unknown length uses the 30 seconds. */
export function secondsToCount(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration / 2, COUNT_AFTER_SECONDS) : COUNT_AFTER_SECONDS
}

/** The seconds that were really heard between two playing times: a normal step counts, a jump or a step back does not. */
export function heardBetween(before: number, now: number): number {
  const step = now - before
  return step > 0 && step <= LONGEST_STEP_SECONDS ? step : 0
}

/** A new list with one more play for the song. The original list is not changed. */
export function recordPlay(plays: readonly Play[], path: string, now: number): Play[] {
  const found = plays.some((play) => play.path === path)
  if (!found) return [...plays, { path, count: 1, last: now }]
  return plays.map((play) => (play.path === path ? { path, count: play.count + 1, last: now } : play))
}

/** The plays of songs that are still in the library, as songs, in the order given by `order` (best first), at most `LIST_SIZE`. */
function listed(songs: readonly Song[], plays: readonly Play[], order: (a: Play, b: Play) => number): Song[] {
  const byPath = new Map(songs.map((song) => [song.path, song]))
  const result: Song[] = []
  for (const play of [...plays].sort(order)) {
    const song = byPath.get(play.path)
    if (song === undefined) continue // gone from the library; its record stays in case the drive is only unplugged
    result.push(song)
    if (result.length === LIST_SIZE) break
  }
  return result
}

/** The songs played last, the newest first. */
export function recentSongs(songs: readonly Song[], plays: readonly Play[]): Song[] {
  return listed(songs, plays, (a, b) => b.last - a.last)
}

/** The songs played most often. Songs with the same number of plays: the one played last comes first. */
export function mostPlayedSongs(songs: readonly Song[], plays: readonly Play[]): Song[] {
  return listed(songs, plays, (a, b) => b.count - a.count || b.last - a.last)
}
