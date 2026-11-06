import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { findCover } from '../src/main/covers.ts'
import { describeSongs, type KnownMap } from '../src/main/describe.ts'
import { loadCache, loadFolders, saveCache, saveFolders } from '../src/main/persist.ts'
import { buildLibrary, scanFolder } from '../src/main/scan.ts'
import { readDetails } from '../src/main/tags.ts'
import type { Details, Library } from '../src/shared/types.ts'

const audio = createRequire(import.meta.url)('./make-audio.cjs')

let base: string
const file = (name: string) => path.join(base, name)

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'brita-details-'))
  await mkdir(file('Musik/Rock'), { recursive: true })
  await writeFile(file('Musik/Rock/tagged.mp3'), audio.makeMp3({ title: 'Wild Hunt', artist: 'Björk', album: 'Debut', picture: audio.makePng() }))
  await writeFile(file('Musik/Rock/tagged.flac'), audio.makeFlac({ title: 'Flac Song', artist: 'Sigur Rós', album: 'Ágætis byrjun' }))
  await writeFile(file('Musik/Rock/tagged.opus'), audio.makeOpus({ title: 'Opus Song', artist: 'Someone', album: 'Else' }))
  await writeFile(file('Musik/Rock/plain.mp3'), audio.makeMp3())
  await writeFile(file('Musik/Rock/damaged.mp3'), 'this is not a song')
  await writeFile(file('Musik/Rock/cover.png'), audio.makePng())
  await mkdir(file('Musik/Jazz'), { recursive: true })
  await writeFile(file('Musik/Jazz/no-cover.mp3'), audio.makeMp3())
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

test('MP3 tags: title, artist, album and length, with umlauts intact', async () => {
  const details = await readDetails(file('Musik/Rock/tagged.mp3'))
  assert.equal(details.title, 'Wild Hunt')
  assert.equal(details.artist, 'Björk')
  assert.equal(details.album, 'Debut')
  assert.ok(details.duration !== null && Math.abs(details.duration - 30) < 1, `length ${details.duration}`)
})

test('FLAC and Opus tags are read', async () => {
  const flac = await readDetails(file('Musik/Rock/tagged.flac'))
  assert.deepEqual([flac.title, flac.artist, flac.album], ['Flac Song', 'Sigur Rós', 'Ágætis byrjun'])
  assert.ok(flac.duration !== null && Math.abs(flac.duration - 29.95) < 1, `length ${flac.duration}`)

  const opus = await readDetails(file('Musik/Rock/tagged.opus'))
  assert.deepEqual([opus.title, opus.artist, opus.album], ['Opus Song', 'Someone', 'Else'])
  assert.ok(opus.duration !== null && Math.abs(opus.duration - 30) < 1, `Opus length ${opus.duration}`)
})

test('a song without tags uses its file name, a damaged file does too', async () => {
  const plain = await readDetails(file('Musik/Rock/plain.mp3'))
  assert.deepEqual([plain.title, plain.artist, plain.album], ['plain', '', ''])
  const damaged = await readDetails(file('Musik/Rock/damaged.mp3'))
  assert.deepEqual(damaged, { title: 'damaged', artist: '', album: '', duration: null })
})

async function describeAll(known: KnownMap, reads: string[]) {
  const library = buildLibrary([await scanFolder(file('Musik'))])
  const snapshots: Array<number | null> = []
  const result = await describeSongs(library.songs, known, {
    isCancelled: () => false,
    read: async (filePath): Promise<Details> => {
      reads.push(path.basename(filePath))
      return readDetails(filePath)
    },
    onSnapshot: (_songs, progress) => snapshots.push(progress === null ? null : progress.total),
  })
  return { result, snapshots }
}

test('details are read once, then remembered until the file changes', async () => {
  const first: string[] = []
  const firstRun = await describeAll(new Map(), first)
  assert.equal(first.length, 6)
  assert.equal(firstRun.result.read, 6)
  assert.deepEqual(firstRun.snapshots[0], 6)
  assert.equal(firstRun.result.songs.find((song) => song.path.endsWith('tagged.mp3'))?.artist, 'Björk')

  const second: string[] = []
  const secondRun = await describeAll(firstRun.result.known, second)
  assert.deepEqual(second, [], 'nothing should be read again')
  assert.equal(secondRun.result.read, 0)
  assert.equal(secondRun.snapshots[0], null)
  assert.equal(secondRun.result.songs.find((song) => song.path.endsWith('tagged.mp3'))?.title, 'Wild Hunt')

  await writeFile(file('Musik/Rock/tagged.opus'), audio.makeOpus({ title: 'Opus Song two', artist: 'Someone', album: 'Else' }))
  await writeFile(file('Musik/Rock/brand-new.mp3'), audio.makeMp3({ title: 'Brand New' }))
  const third: string[] = []
  const thirdRun = await describeAll(secondRun.result.known, third)
  assert.deepEqual(third.sort(), ['brand-new.mp3', 'tagged.opus'])
  assert.equal(thirdRun.result.songs.find((song) => song.path.endsWith('tagged.opus'))?.title, 'Opus Song two')
})

test('a stopped refresh reads nothing more', async () => {
  const library = buildLibrary([await scanFolder(file('Musik'))])
  const reads: string[] = []
  const result = await describeSongs(library.songs, new Map(), {
    isCancelled: () => true,
    read: async (filePath) => { reads.push(filePath); return readDetails(filePath) },
    onSnapshot: () => {},
  })
  assert.deepEqual(reads, [])
  assert.equal(result.known.size, 0)
})

test('the cover comes from the song file first, then from a picture in the folder', async () => {
  const embedded = await findCover(file('Musik/Rock/tagged.mp3'))
  assert.equal(embedded?.type, 'image/png')
  assert.ok(embedded !== null && embedded.data.length > 20)

  const fromFolder = await findCover(file('Musik/Rock/plain.mp3'))
  assert.equal(fromFolder?.type, 'image/png')

  assert.equal(await findCover(file('Musik/Jazz/no-cover.mp3')), null)
  assert.equal((await findCover(file('Musik/Rock/damaged.mp3')))?.type, 'image/png', 'a damaged song still gets the folder picture')
})

test('folders and the library cache survive a round trip, damaged files are ignored', async () => {
  const foldersFile = file('state/folders.json')
  assert.deepEqual(await loadFolders(foldersFile), [])
  await saveFolders(foldersFile, ['G:\\Musik', 'D:\\More'])
  assert.deepEqual(await loadFolders(foldersFile), ['G:\\Musik', 'D:\\More'])

  const library: Library = { folders: ['G:\\Musik'], playlists: [], songs: [], unreadable: [], missing: [] }
  const cacheFile = file('state/library-cache.json')
  assert.equal(await loadCache(cacheFile), null)
  await saveCache(cacheFile, library, { 'g:\\musik\\a.mp3': { size: 1, mtimeMs: 2 } })
  const cache = await loadCache(cacheFile)
  assert.deepEqual(cache?.library, library)
  assert.deepEqual(cache?.stamps, { 'g:\\musik\\a.mp3': { size: 1, mtimeMs: 2 } })

  // A library saved before missing folders were tracked still loads.
  const old = { version: 1, library: { folders: ['G:\\Musik'], playlists: [], songs: [], unreadable: [] }, stamps: {} }
  await writeFile(cacheFile, JSON.stringify(old))
  assert.deepEqual((await loadCache(cacheFile))?.library.missing, [])

  await writeFile(cacheFile, '{ this is broken')
  await writeFile(foldersFile, '[1, 2')
  assert.equal(await loadCache(cacheFile), null)
  assert.deepEqual(await loadFolders(foldersFile), [])
})
