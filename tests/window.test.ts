import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadWindowState, sanitizeWindowState, saveWindowState } from '../src/main/windowState.ts'

const main = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 1920, height: 1040 }

test('a saved window that fits a screen comes back unchanged', () => {
  const saved = { x: 100, y: 80, width: 1000, height: 650, maximized: false }
  assert.deepEqual(sanitizeWindowState(saved, [main]), saved)
  assert.equal(sanitizeWindowState({ ...saved, maximized: true }, [main])?.maximized, true)
  assert.equal(sanitizeWindowState({ ...saved, maximized: 'yes' }, [main])?.maximized, false)
})

test('a window on a second screen stays there while that screen exists', () => {
  const saved = { x: 2100, y: 60, width: 1100, height: 700, maximized: false }
  assert.deepEqual(sanitizeWindowState(saved, [main, right]), saved)
})

test('when the second screen is gone, the position is dropped and Windows places the window', () => {
  const saved = { x: 2100, y: 60, width: 1100, height: 700, maximized: false }
  assert.deepEqual(sanitizeWindowState(saved, [main]), { width: 1100, height: 700, maximized: false })
})

test('a window that would lie mostly off the screen is moved back; a sliver on the screen is not enough', () => {
  const sliver = { x: 1880, y: 100, width: 1000, height: 650, maximized: false }
  assert.equal(sanitizeWindowState(sliver, [main])?.x, undefined)
  const above = { x: 100, y: -300, width: 1000, height: 650, maximized: false }
  assert.equal(sanitizeWindowState(above, [main])?.y, undefined)
  const below = { x: 100, y: 1030, width: 1000, height: 650, maximized: false }
  assert.equal(sanitizeWindowState(below, [main])?.y, undefined)
})

test('size is kept inside the minimum and the screen', () => {
  const tiny = sanitizeWindowState({ x: 10, y: 10, width: 100, height: 100 }, [main])
  assert.deepEqual([tiny?.width, tiny?.height], [800, 500])
  const huge = sanitizeWindowState({ x: 0, y: 0, width: 5000, height: 4000 }, [main])
  assert.deepEqual([huge?.width, huge?.height], [1920, 1040])
})

test('nothing usable stored gives null', () => {
  assert.equal(sanitizeWindowState(null, [main]), null)
  assert.equal(sanitizeWindowState('text', [main]), null)
  assert.equal(sanitizeWindowState({ width: 'wide', height: 500 }, [main]), null)
  assert.equal(sanitizeWindowState({ width: Number.NaN, height: 500 }, [main]), null)
})

test('the window state is written and read back, and a missing or damaged file gives null', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'brita-window-'))
  try {
    const file = path.join(folder, 'sub', 'window.json')
    assert.equal(loadWindowState(file, [main]), null)
    const state = { x: 40, y: 50, width: 900, height: 600, maximized: true }
    saveWindowState(file, state)
    assert.deepEqual(loadWindowState(file, [main]), state)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), state)
    writeFileSync(file, '{ this is not json')
    assert.equal(loadWindowState(file, [main]), null)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
