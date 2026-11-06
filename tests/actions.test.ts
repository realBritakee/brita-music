import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { findSong, isSongPath } from '../src/main/songActions.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'brita-actions-'))
const music = path.join(root, 'Musik')
const outside = path.join(root, 'Other')
mkdirSync(path.join(music, 'List'), { recursive: true })
mkdirSync(outside)
const song = path.join(music, 'List', 'a.mp3')
writeFileSync(song, '')
writeFileSync(path.join(music, 'notes.txt'), '')
writeFileSync(path.join(outside, 'b.mp3'), '')

test.after(() => rmSync(root, { recursive: true, force: true }))

test('a music file inside an added folder is accepted', () => {
  assert.equal(isSongPath(song, [music]), true)
})

test('files outside the added folders, other file types and odd values are refused', () => {
  assert.equal(isSongPath(path.join(outside, 'b.mp3'), [music]), false)
  assert.equal(isSongPath(path.join(music, 'notes.txt'), [music]), false)
  assert.equal(isSongPath(path.join(music, '..', 'Other', 'b.mp3'), [music]), false)
  assert.equal(isSongPath(song, []), false)
  assert.equal(isSongPath('a.mp3', [music]), false)
  assert.equal(isSongPath('', [music]), false)
  assert.equal(isSongPath(null, [music]), false)
  assert.equal(isSongPath(42, [music]), false)
  assert.equal(isSongPath(music, [music]), false)
})

test('finding a song also needs the file to exist', async () => {
  assert.equal(await findSong(song, [music]), path.normalize(song))
  assert.equal(await findSong(path.join(music, 'gone.mp3'), [music]), null)
  assert.equal(await findSong(path.join(outside, 'b.mp3'), [music]), null)
})
