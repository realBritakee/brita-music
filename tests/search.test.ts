import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Song } from '../src/shared/types.ts'
import { filterSongs, nextSort, normalize, sortSongs } from '../src/renderer/src/search.ts'

function song(title: string, artist = '', album = '', duration: number | null = 100): Song {
  return { path: `C:/music/${title}.mp3`, ext: 'mp3', playlist: null, title, artist, album, duration }
}

const songs = [
  song('Wild Hunt', 'Björk', 'Debut', 200),
  song('Flac Song', 'Sigur Rós', 'Ágætis byrjun', 90),
  song('Track 10', 'Zed', '', null),
  song('Track 2', '', 'Alpha', 60),
  song('Track 1', 'Abba', 'Alpha', 60),
]
const titles = (list: Song[]) => list.map((item) => item.title)

test('an empty or blank query keeps every song', () => {
  assert.equal(filterSongs(songs, ''), songs)
  assert.equal(filterSongs(songs, '   '), songs)
})

test('search finds a song by title, artist or album', () => {
  assert.deepEqual(titles(filterSongs(songs, 'wild')), ['Wild Hunt'])
  assert.deepEqual(titles(filterSongs(songs, 'sigur')), ['Flac Song'])
  assert.deepEqual(titles(filterSongs(songs, 'debut')), ['Wild Hunt'])
  assert.deepEqual(titles(filterSongs(songs, 'alpha')), ['Track 2', 'Track 1'])
})

test('search ignores case and accents, in the query and in the song', () => {
  assert.deepEqual(titles(filterSongs(songs, 'BJORK')), ['Wild Hunt'])
  assert.deepEqual(titles(filterSongs(songs, 'björk')), ['Wild Hunt'])
  assert.deepEqual(titles(filterSongs(songs, 'agaetis')), [])
  assert.deepEqual(titles(filterSongs(songs, 'agtis')), [])
  assert.deepEqual(titles(filterSongs(songs, 'sigur ros')), ['Flac Song'])
  assert.equal(normalize('Ágætis'), 'agætis')
})

test('every word of the query must match, in any order, across the three fields', () => {
  assert.deepEqual(titles(filterSongs(songs, 'hunt bjork')), ['Wild Hunt'])
  assert.deepEqual(titles(filterSongs(songs, 'bjork flac')), [])
  assert.deepEqual(titles(filterSongs(songs, 'nothing here')), [])
})

test('a song without tags is found by its file name, which is its title', () => {
  assert.deepEqual(titles(filterSongs([song('tone-wav')], 'tone')), ['tone-wav'])
})

test('clicking a column title goes A to Z, Z to A, then back to the folder order', () => {
  const first = nextSort(null, 'title')
  assert.deepEqual(first, { key: 'title', descending: false })
  const second = nextSort(first, 'title')
  assert.deepEqual(second, { key: 'title', descending: true })
  assert.equal(nextSort(second, 'title'), null)
  assert.deepEqual(nextSort(second, 'artist'), { key: 'artist', descending: false })
})

test('no sort keeps the folder order', () => {
  assert.equal(sortSongs(songs, null), songs)
})

test('sorting by title puts numbers in natural order and does not change the original list', () => {
  const copy = [...songs]
  assert.deepEqual(titles(sortSongs(songs, { key: 'title', descending: false })), ['Flac Song', 'Track 1', 'Track 2', 'Track 10', 'Wild Hunt'])
  assert.deepEqual(titles(sortSongs(songs, { key: 'title', descending: true })), ['Wild Hunt', 'Track 10', 'Track 2', 'Track 1', 'Flac Song'])
  assert.deepEqual(songs, copy)
})

test('songs with no artist or album come last in both directions', () => {
  assert.deepEqual(titles(sortSongs(songs, { key: 'artist', descending: false })), ['Track 1', 'Wild Hunt', 'Flac Song', 'Track 10', 'Track 2'])
  assert.deepEqual(titles(sortSongs(songs, { key: 'artist', descending: true })), ['Track 10', 'Flac Song', 'Wild Hunt', 'Track 1', 'Track 2'])
  assert.equal(titles(sortSongs(songs, { key: 'album', descending: false })).at(-1), 'Track 10')
  assert.equal(titles(sortSongs(songs, { key: 'album', descending: true })).at(-1), 'Track 10')
})

test('sorting by length is by seconds, unknown lengths come last, and ties keep the folder order', () => {
  assert.deepEqual(titles(sortSongs(songs, { key: 'length', descending: false })), ['Track 2', 'Track 1', 'Flac Song', 'Wild Hunt', 'Track 10'])
  assert.deepEqual(titles(sortSongs(songs, { key: 'length', descending: true })), ['Wild Hunt', 'Flac Song', 'Track 2', 'Track 1', 'Track 10'])
})
