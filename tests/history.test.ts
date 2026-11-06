import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadHistory, sanitizePlays, saveHistory } from '../src/main/persist.ts'
import { heardBetween, LIST_SIZE, mostPlayedSongs, MOST_VIEW, recentSongs, RECENT_VIEW, recordPlay, secondsToCount } from '../src/renderer/src/history.ts'
import type { Play, Song } from '../src/shared/types.ts'

function song(name: string): Song {
  return { path: name, ext: 'mp3', playlist: null, title: name, artist: '', album: '', duration: 100 }
}

test('a song counts after 30 seconds, or after half of it if it is shorter; an unknown length uses 30 seconds', () => {
  assert.equal(secondsToCount(240), 30)
  assert.equal(secondsToCount(60), 30)
  assert.equal(secondsToCount(20), 10)
  assert.equal(secondsToCount(0), 30)
  assert.equal(secondsToCount(Number.NaN), 30)
  assert.equal(secondsToCount(Number.POSITIVE_INFINITY), 30)
})

test('only normal steps of the playing time count as listening; a jump forward or back does not', () => {
  assert.equal(heardBetween(10, 10.25), 0.25)
  assert.equal(heardBetween(10, 12.9), 2.9000000000000004)
  assert.equal(heardBetween(10, 100), 0)
  assert.equal(heardBetween(100, 10), 0)
  assert.equal(heardBetween(5, 5), 0)
})

test('a play is added once per song, raises its count, moves its time, and does not change the original list', () => {
  const start: Play[] = [{ path: 'a', count: 1, last: 10 }]
  const second = recordPlay(start, 'b', 20)
  assert.deepEqual(second, [{ path: 'a', count: 1, last: 10 }, { path: 'b', count: 1, last: 20 }])
  const third = recordPlay(second, 'a', 30)
  assert.deepEqual(third, [{ path: 'a', count: 2, last: 30 }, { path: 'b', count: 1, last: 20 }])
  assert.deepEqual(start, [{ path: 'a', count: 1, last: 10 }])
})

test('Recently played: newest first, songs that are gone from the library are not shown', () => {
  const songs = [song('a'), song('b'), song('c')]
  const plays: Play[] = [{ path: 'a', count: 5, last: 10 }, { path: 'gone', count: 9, last: 99 }, { path: 'c', count: 1, last: 30 }, { path: 'b', count: 2, last: 20 }]
  assert.deepEqual(recentSongs(songs, plays).map((item) => item.path), ['c', 'b', 'a'])
  assert.deepEqual(recentSongs(songs, []), [])
})

test('Most played: most plays first, the same number of plays goes to the one played last, songs that are gone are not shown', () => {
  const songs = [song('a'), song('b'), song('c'), song('d')]
  const plays: Play[] = [
    { path: 'a', count: 2, last: 10 }, { path: 'b', count: 7, last: 5 }, { path: 'gone', count: 50, last: 1 },
    { path: 'c', count: 2, last: 40 }, { path: 'd', count: 1, last: 90 },
  ]
  assert.deepEqual(mostPlayedSongs(songs, plays).map((item) => item.path), ['b', 'c', 'a', 'd'])
})

test('both lists stop at the list size, and the original plays are not reordered', () => {
  const songs = Array.from({ length: LIST_SIZE + 10 }, (_, index) => song(`s${index}`))
  const plays = songs.map((item, index): Play => ({ path: item.path, count: 1, last: index }))
  const before = JSON.stringify(plays)
  assert.equal(recentSongs(songs, plays).length, LIST_SIZE)
  assert.equal(mostPlayedSongs(songs, plays).length, LIST_SIZE)
  assert.equal(recentSongs(songs, plays)[0]?.path, `s${LIST_SIZE + 9}`)
  assert.equal(JSON.stringify(plays), before)
})

test('the view keys of the two lists can never be the key of a playlist folder (a colon is not allowed in Windows names)', () => {
  assert.ok(RECENT_VIEW.includes(':') && MOST_VIEW.includes(':'))
  assert.notEqual(RECENT_VIEW as string, MOST_VIEW as string)
})

test('stored plays: a text path, a whole count of at least 1 and a time; anything else is dropped, a doubled song keeps its first entry', () => {
  const good = { path: 'a', count: 3, last: 100 }
  assert.deepEqual(sanitizePlays({ plays: [good, { path: 'a', count: 9, last: 1 }, { path: '', count: 1, last: 1 }, { path: 'b', count: 0, last: 1 }, { path: 'c', count: 1.5, last: 1 }, { path: 'd', count: 1, last: -1 }, { path: 'e', count: 1, last: 'x' }, { path: 7, count: 1, last: 1 }, null, 'text'] }), [good])
  assert.deepEqual(sanitizePlays({ plays: 'a' }), [])
  assert.deepEqual(sanitizePlays({}), [])
  assert.deepEqual(sanitizePlays(null), [])
  assert.deepEqual(sanitizePlays([good]), [])
})

test('the play history survives being saved and loaded; a missing or damaged file gives an empty list', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'brita-hist-'))
  try {
    const file = path.join(folder, 'nested', 'history.json')
    assert.deepEqual(await loadHistory(file), [])
    const plays: Play[] = [{ path: 'D:\\Musik\\a.mp3', count: 2, last: 1700000000000 }, { path: 'D:\\Musik\\Ö ü.flac', count: 1, last: 1700000005000 }]
    await saveHistory(file, plays)
    assert.deepEqual(await loadHistory(file), plays)
    await writeFile(file, '{ this is not json', 'utf8')
    assert.deepEqual(await loadHistory(file), [])
    await saveHistory(file, [])
    assert.equal(await readFile(file, 'utf8'), '{"plays":[]}')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
