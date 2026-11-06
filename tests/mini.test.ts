import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { defaultMiniPosition, isMiniKey, loadMiniPosition, MINI_SIZE, sanitizeMiniPosition, saveMiniPosition } from '../src/main/miniModel.ts'

const main = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 1000 }

test('mini player: only previous, play-pause and next are passed on to the player', () => {
  for (const key of ['previous', 'play-pause', 'next']) assert.equal(isMiniKey(key), true)
  for (const bad of ['stop', 'quit', '', 'Next', null, undefined, 3, {}, ['next']]) assert.equal(isMiniKey(bad), false)
})

test('mini player: it first opens in the bottom right corner of the screen area, with a margin', () => {
  const position = defaultMiniPosition(main)
  assert.equal(position.x + MINI_SIZE.width, main.width - 16)
  assert.equal(position.y + MINI_SIZE.height, main.height - 16)
  const onSecond = defaultMiniPosition(second)
  assert.equal(onSecond.x + MINI_SIZE.width, second.x + second.width - 16)
})

test('mini player: a screen area smaller than the window never gives a negative offset', () => {
  assert.deepEqual(defaultMiniPosition({ x: 100, y: 50, width: 200, height: 40 }), { x: 100, y: 50 })
})

test('mini player: a remembered position on a screen that exists is kept', () => {
  assert.deepEqual(sanitizeMiniPosition({ x: 2000, y: 100 }, [main, second]), { x: 2000, y: 100 })
  assert.deepEqual(sanitizeMiniPosition({ x: 10.4, y: 20.6 }, [main]), { x: 10, y: 21 })
})

test('mini player: a position on a screen that is gone, or hardly on any screen, is dropped', () => {
  assert.equal(sanitizeMiniPosition({ x: 2000, y: 100 }, [main]), null)
  assert.equal(sanitizeMiniPosition({ x: main.width - 30, y: 100 }, [main]), null)
  assert.equal(sanitizeMiniPosition({ x: 100, y: main.height - 10 }, [main]), null)
  assert.equal(sanitizeMiniPosition({ x: -5000, y: 0 }, [main]), null)
})

test('mini player: stored data that is not a position is dropped', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { x: 1 }, { x: 'a', y: 2 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }]) {
    assert.equal(sanitizeMiniPosition(bad, [main]), null)
  }
})

test('mini player: the position is saved and read back; no file or a damaged file means no position', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'brita-mini-'))
  try {
    const file = path.join(folder, 'mini.json')
    assert.equal(loadMiniPosition(file, [main]), null)
    saveMiniPosition(file, { x: 300, y: 400 })
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { x: 300, y: 400 })
    assert.deepEqual(loadMiniPosition(file, [main]), { x: 300, y: 400 })
    writeFileSync(file, '{ not json')
    assert.equal(loadMiniPosition(file, [main]), null)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
