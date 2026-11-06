import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_SONG, sanitizeReport, trayEntries, trayTooltip } from '../src/main/trayMenu.ts'

const song = { title: 'Wish You Were Here', artist: 'Pink Floyd', path: 'C:/Musik/wish.mp3' }
const labels = (report: Parameters<typeof trayEntries>[0]) =>
  trayEntries(report).map((entry) => (entry.kind === 'separator' ? '---' : entry.label))

test('tray menu: nothing loaded shows Open, Play and Next (both waiting), Quit, and no song line', () => {
  assert.deepEqual(labels(NO_SONG), ['Open Brita Music', 'Mini player', '---', 'Play', 'Next', '---', 'Quit'])
  const waiting = trayEntries(NO_SONG).filter((entry) => entry.kind === 'item' && (entry.action === 'play-pause' || entry.action === 'next'))
  assert.equal(waiting.length, 2)
  assert.ok(waiting.every((entry) => entry.kind === 'item' && !entry.enabled))
})

test('tray menu: a paused song shows its name and Play, a playing song shows Pause', () => {
  assert.deepEqual(labels({ playing: false, song }), ['Wish You Were Here - Pink Floyd', '---', 'Open Brita Music', 'Mini player', '---', 'Play', 'Next', '---', 'Quit'])
  assert.ok(labels({ playing: true, song }).includes('Pause'))
  assert.ok(!labels({ playing: true, song }).includes('Play'))
})

test('tray menu: Play, Pause and Next are chosen when a song is loaded; the song line is only a label', () => {
  const items = trayEntries({ playing: true, song }).flatMap((entry) => (entry.kind === 'item' ? [entry] : []))
  const enabled = (action: string) => items.find((item) => item.action === action)?.enabled
  assert.equal(enabled('play-pause'), true)
  assert.equal(enabled('next'), true)
  assert.equal(enabled('open'), true)
  assert.equal(enabled('mini'), true)
  assert.equal(enabled('quit'), true)
  assert.equal(items[0].enabled, false)
  assert.equal(items[0].action, null)
})

test('tray menu: a song without an artist shows only the title', () => {
  assert.equal(labels({ playing: false, song: { title: 'Intro', artist: '', path: '' } })[0], 'Intro')
  assert.equal(trayTooltip({ playing: false, song: { title: 'Intro', artist: '', path: '' } }), 'Brita Music: Intro')
})

test('tray tooltip: the app name alone, or the name and the song, and never longer than Windows allows', () => {
  assert.equal(trayTooltip(NO_SONG), 'Brita Music')
  assert.equal(trayTooltip({ playing: true, song }), 'Brita Music: Wish You Were Here - Pink Floyd')
  const long = trayTooltip({ playing: true, song: { title: 'x'.repeat(300), artist: 'y', path: '' } })
  assert.equal(long.length, 127)
  assert.ok(long.endsWith('…'))
})

test('player report: only a well-formed report is used, everything else means nothing is loaded', () => {
  assert.deepEqual(sanitizeReport({ playing: true, song }), { playing: true, song })
  assert.deepEqual(sanitizeReport({ playing: 'yes', song }), { playing: false, song })
  assert.deepEqual(sanitizeReport({ playing: true, song: { title: 'T' } }), { playing: true, song: { title: 'T', artist: '', path: '' } })
  assert.deepEqual(sanitizeReport({ playing: true, song: { title: 'T', artist: 'A', path: 7 } }), { playing: true, song: { title: 'T', artist: 'A', path: '' } })
  for (const bad of [null, undefined, 5, 'x', {}, { playing: true }, { playing: true, song: null }, { playing: true, song: { title: 3 } }]) {
    assert.deepEqual(sanitizeReport(bad), NO_SONG)
  }
})
