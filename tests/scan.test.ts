import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { isInsideFolder, parseRange } from '../src/main/media.ts'
import { buildLibrary, scanFolder } from '../src/main/scan.ts'

let base: string

async function put(relative: string): Promise<void> {
  const full = path.join(base, relative)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, '')
}

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'brita-scan-'))
  await put('Musik/loose.mp3')
  await put('Musik/notes.txt')
  await put('Musik/The White Buffalo/one.MP3')
  await put('Musik/The White Buffalo/Album 1/two.flac')
  await put('Musik/The White Buffalo/Album 1/Disc 2/three.m4a')
  await put('Musik/$RECYCLE.BIN/deleted.mp3')
  await mkdir(path.join(base, 'Musik/Empty Playlist'), { recursive: true })
  await put('Other/the white buffalo/four.ogg')
  await put('Other/Rock/five.wav')
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

test('folders directly inside the music folder become playlists, deeper ones do not', async () => {
  const scan = await scanFolder(path.join(base, 'Musik'))
  assert.deepEqual([...scan.playlists].sort(), ['Empty Playlist', 'The White Buffalo'])
})

test('every music file is found however deep, other files and the recycle bin are not', async () => {
  const library = buildLibrary([await scanFolder(path.join(base, 'Musik'))])
  assert.deepEqual(library.songs.map((song) => song.title).sort(), ['loose', 'one', 'three', 'two'])
})

test('songs in deeper folders belong to the top playlist, loose songs to none', async () => {
  const library = buildLibrary([await scanFolder(path.join(base, 'Musik'))])
  const playlistOf = (title: string) => library.songs.find((song) => song.title === title)?.playlist
  assert.equal(playlistOf('three'), 'the white buffalo')
  assert.equal(playlistOf('one'), 'the white buffalo')
  assert.equal(playlistOf('loose'), null)
})

test('the same playlist name in two music folders becomes one playlist', async () => {
  const library = buildLibrary([
    await scanFolder(path.join(base, 'Musik')),
    await scanFolder(path.join(base, 'Other')),
  ])
  assert.deepEqual(library.playlists.map((playlist) => playlist.name), ['Empty Playlist', 'Rock', 'The White Buffalo'])
  assert.equal(library.songs.filter((song) => song.playlist === 'the white buffalo').length, 4)
})

test('a music folder that is not there is reported as missing, not hidden', async () => {
  const gone = path.join(base, 'does-not-exist')
  const library = buildLibrary([await scanFolder(gone), await scanFolder(path.join(base, 'Musik'))])
  assert.deepEqual(library.missing, [gone])
  assert.deepEqual(library.unreadable, [])
  assert.equal(library.songs.length, 4)
  assert.deepEqual(library.folders, [gone, path.join(base, 'Musik')])
})

test('a music folder that is there is not reported as missing', async () => {
  const library = buildLibrary([await scanFolder(path.join(base, 'Musik'))])
  assert.deepEqual(library.missing, [])
})

test('byte ranges for the seek bar', () => {
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 })
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseRange('bytes=100-', 100), null)
  assert.equal(parseRange('bytes=-', 100), null)
  assert.equal(parseRange('nonsense', 100), null)
})

test('only files inside an added folder count as inside', () => {
  const folder = path.join('G:', 'Musik')
  assert.equal(isInsideFolder(path.join(folder, 'a', 'b.mp3'), folder), true)
  assert.equal(isInsideFolder(path.join('G:', 'Musik2', 'b.mp3'), folder), false)
  assert.equal(isInsideFolder(path.join(folder, '..', 'secret.mp3'), folder), false)
  assert.equal(isInsideFolder(folder, folder), false)
})
