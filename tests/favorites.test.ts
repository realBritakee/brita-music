import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadFavorites, sanitizeFavorites, saveFavorites } from '../src/main/persist.ts'
import { FAVORITES_VIEW, onlyFavorites, toggled } from '../src/renderer/src/favorites.ts'

test('a heart is added once and taken away again, and the original list is not changed', () => {
  const start = ['a.mp3']
  assert.deepEqual(toggled(start, 'b.mp3'), ['a.mp3', 'b.mp3'])
  assert.deepEqual(toggled(start, 'a.mp3'), [])
  assert.deepEqual(toggled(toggled(start, 'b.mp3'), 'b.mp3'), start)
  assert.deepEqual(start, ['a.mp3'])
})

test('the Favorites list shows the songs with a heart in library order, and skips hearts for songs that are gone', () => {
  const songs = [{ path: 'a' }, { path: 'b' }, { path: 'c' }]
  assert.deepEqual(onlyFavorites(songs, ['c', 'a', 'gone']), [{ path: 'a' }, { path: 'c' }])
  assert.deepEqual(onlyFavorites(songs, []), [])
})

test('the Favorites view key can never be the key of a playlist folder (a colon is not allowed in Windows names)', () => {
  assert.ok(FAVORITES_VIEW.includes(':'))
})

test('stored favorites: only text paths, no empty entries, each path once; anything else gives an empty list', () => {
  assert.deepEqual(sanitizeFavorites({ songs: ['a', 'b', 'a', '', 7, null, 'c'] }), ['a', 'b', 'c'])
  assert.deepEqual(sanitizeFavorites({ songs: 'a' }), [])
  assert.deepEqual(sanitizeFavorites({}), [])
  assert.deepEqual(sanitizeFavorites(null), [])
  assert.deepEqual(sanitizeFavorites([1, 2]), [])
})

test('favorites survive being saved and loaded; a missing or damaged file gives an empty list', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'brita-fav-'))
  try {
    const file = path.join(folder, 'nested', 'favorites.json')
    assert.deepEqual(await loadFavorites(file), [])
    await saveFavorites(file, ['D:\Musik\a.mp3', 'D:\Musik\Ö ü.flac'])
    assert.deepEqual(await loadFavorites(file), ['D:\Musik\a.mp3', 'D:\Musik\Ö ü.flac'])
    await writeFile(file, '{ this is not json', 'utf8')
    assert.deepEqual(await loadFavorites(file), [])
    await saveFavorites(file, [])
    assert.equal(await readFile(file, 'utf8'), '{"songs":[]}')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
