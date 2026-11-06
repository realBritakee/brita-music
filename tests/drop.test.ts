import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { checkNewFolder, copyIntoPlaylist, handleDrop, playlistFolder, sortDropped } from '../src/main/drop.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'brita-drop-'))
const music = path.join(root, 'Musik')
const other = path.join(root, 'Other')
const incoming = path.join(root, 'Incoming')
mkdirSync(path.join(music, 'Rock'), { recursive: true })
mkdirSync(path.join(other, 'Jazz'), { recursive: true })
mkdirSync(path.join(incoming, 'Sub'), { recursive: true })
writeFileSync(path.join(incoming, 'a.mp3'), 'AAA')
writeFileSync(path.join(incoming, 'b.flac'), 'BBB')
writeFileSync(path.join(incoming, 'notes.txt'), 'text')

test.after(() => rmSync(root, { recursive: true, force: true }))

const noFolders = async () => { throw new Error('no folder should be added') }

test('dropped items are sorted into folders and files; odd values count as unreadable', async () => {
  const sorted = await sortDropped([incoming, path.join(incoming, 'a.mp3'), path.join(incoming, 'gone.mp3'), 'relative.mp3', 42])
  assert.deepEqual(sorted.dirs, [path.normalize(incoming)])
  assert.deepEqual(sorted.files, [path.normalize(path.join(incoming, 'a.mp3'))])
  assert.equal(sorted.unreadable, 3)
  assert.deepEqual(await sortDropped('nope'), { dirs: [], files: [], unreadable: 0 })
})

test('a new folder is accepted; a known folder or one inside a music folder is refused in plain words', async () => {
  const fresh = await checkNewFolder([music], other)
  assert.equal(fresh.ok, true)
  const same = await checkNewFolder([music], music)
  assert.deepEqual(same, { ok: false, message: '“Musik” is already a music folder.' })
  const inside = await checkNewFolder([music], path.join(music, 'Rock'))
  assert.deepEqual(inside, { ok: false, message: '“Rock” is already inside a music folder.' })
  const gone = await checkNewFolder([music], path.join(root, 'Missing'))
  assert.equal(gone.ok, false)
})

test('a playlist folder is found by its lower-case key in any music folder', async () => {
  assert.equal(await playlistFolder([music, other], 'rock'), path.join(music, 'Rock'))
  assert.equal(await playlistFolder([music, other], 'jazz'), path.join(other, 'Jazz'))
  assert.equal(await playlistFolder([music, other], 'pop'), null)
  assert.equal(await playlistFolder([music, other], ''), null)
  assert.equal(await playlistFolder([music, other], 7), null)
})

test('dropping songs on a playlist copies them, keeps the originals, and skips other file types', async () => {
  const result = await handleDrop([music], [path.join(incoming, 'a.mp3'), path.join(incoming, 'b.flac'), path.join(incoming, 'notes.txt')], 'rock', noFolders)
  assert.equal(result.copied, 2)
  assert.equal(result.added, 0)
  assert.match(result.message ?? '', /2 songs copied/)
  assert.match(result.message ?? '', /“notes.txt” is not a music file/)
  assert.equal(readFileSync(path.join(music, 'Rock', 'a.mp3'), 'utf8'), 'AAA')
  assert.equal(readFileSync(path.join(incoming, 'a.mp3'), 'utf8'), 'AAA')
})

test('a name that already exists is never overwritten and gets a plain message', async () => {
  writeFileSync(path.join(music, 'Rock', 'a.mp3'), 'KEEP')
  const result = await handleDrop([music], [path.join(incoming, 'a.mp3')], 'rock', noFolders)
  assert.equal(result.copied, 0)
  assert.match(result.message ?? '', /“a.mp3” is already in this playlist/)
  assert.equal(readFileSync(path.join(music, 'Rock', 'a.mp3'), 'utf8'), 'KEEP')
})

test('a song dropped from inside the playlist itself is not copied onto itself', async () => {
  const result = await copyIntoPlaylist(path.join(music, 'Rock'), [path.join(music, 'Rock', 'a.mp3')])
  assert.equal(result.copied, 0)
  assert.equal(readFileSync(path.join(music, 'Rock', 'a.mp3'), 'utf8'), 'KEEP')
})

test('a folder dropped on a playlist is refused; songs dropped elsewhere are refused', async () => {
  const onList = await handleDrop([music], [path.join(incoming, 'Sub')], 'rock', noFolders)
  assert.equal(onList.copied + onList.added, 0)
  assert.match(onList.message ?? '', /Folders cannot be copied into a playlist/)
  const onWindow = await handleDrop([music], [path.join(incoming, 'a.mp3')], null, noFolders)
  assert.match(onWindow.message ?? '', /drop them onto a playlist/)
  const unknown = await handleDrop([music], [path.join(incoming, 'a.mp3')], 'pop', noFolders)
  assert.match(unknown.message ?? '', /playlist folder cannot be found/)
})

test('dropping folders on the window adds the new ones once and reports the rest', async () => {
  const added: string[] = []
  const result = await handleDrop([music], [other, other, music], null, async (folder) => { added.push(folder) })
  assert.equal(result.added, 1)
  assert.equal(added.length, 1)
  assert.match(result.message ?? '', /Music folder added\./)
  assert.match(result.message ?? '', /already a music folder/)
})

test('nothing to say gives no message', async () => {
  assert.deepEqual(await handleDrop([music], [], null, noFolders), { added: 0, copied: 0, message: null })
})
