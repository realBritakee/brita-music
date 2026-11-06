import assert from 'node:assert/strict'
import { test } from 'node:test'
import { glyphBitmap } from '../src/main/thumbGlyphs.ts'
import { thumbSignature, thumbSpecs } from '../src/main/thumbModel.ts'
import { NO_SONG } from '../src/main/trayMenu.ts'

const song = { title: 'Wish You Were Here', artist: 'Pink Floyd', path: 'C:/Musik/wish.mp3' }

test('thumbnail buttons: always previous, play or pause, next, and they wait while no song is loaded', () => {
  const specs = thumbSpecs(NO_SONG)
  assert.deepEqual(specs.map((spec) => spec.action), ['previous', 'play-pause', 'next'])
  assert.deepEqual(specs.map((spec) => spec.tooltip), ['Previous', 'Play', 'Next'])
  assert.ok(specs.every((spec) => !spec.enabled))
})

test('thumbnail buttons: a loaded song enables all three; a playing song shows Pause', () => {
  const paused = thumbSpecs({ playing: false, song })
  assert.ok(paused.every((spec) => spec.enabled))
  assert.equal(paused[1].glyph, 'play')
  const playing = thumbSpecs({ playing: true, song })
  assert.equal(playing[1].glyph, 'pause')
  assert.equal(playing[1].tooltip, 'Pause')
  assert.equal(playing.length, 3)
})

test('thumbnail buttons: the signature changes with the icon and the enabled state, not with the song', () => {
  const a = thumbSignature(thumbSpecs({ playing: false, song }))
  assert.equal(a, thumbSignature(thumbSpecs({ playing: false, song: { title: 'Other', artist: '', path: '' } })))
  assert.notEqual(a, thumbSignature(thumbSpecs({ playing: true, song })))
  assert.notEqual(a, thumbSignature(thumbSpecs(NO_SONG)))
})

const alphaAt = (bitmap: Buffer, size: number, x: number, y: number) => bitmap[(y * size + x) * 4 + 3]

test('thumbnail icons: right size, and the shapes sit where they should', () => {
  for (const size of [16, 24, 32]) {
    const play = glyphBitmap('play', size)
    assert.equal(play.length, size * size * 4)
    const mid = Math.floor(size / 2)
    assert.equal(alphaAt(play, size, Math.floor(size * 0.4), mid), 255, 'the triangle covers the middle')
    assert.equal(alphaAt(play, size, 0, 0), 0, 'the corner stays clear')
    assert.equal(alphaAt(play, size, size - 1, size - 1), 0)

    const pause = glyphBitmap('pause', size)
    assert.equal(alphaAt(pause, size, Math.floor(size * 0.3), mid), 255, 'left bar')
    assert.equal(alphaAt(pause, size, Math.floor(size * 0.7), mid), 255, 'right bar')
    assert.equal(alphaAt(pause, size, mid, mid), 0, 'a gap between the bars')

    const previous = glyphBitmap('previous', size)
    const next = glyphBitmap('next', size)
    assert.equal(alphaAt(previous, size, Math.floor(size * 0.2), mid), 255, 'previous has its bar on the left')
    assert.equal(alphaAt(next, size, Math.floor(size * 0.8), mid), 255, 'next has its bar on the right')
    assert.equal(alphaAt(previous, size, Math.floor(size * 0.8), mid) > 0, true, 'previous points left, its wide end is on the right')
  }
})

test('thumbnail icons: pixels are orange and already multiplied by their alpha (blue, green, red, alpha order)', () => {
  const size = 16
  const pause = glyphBitmap('pause', size)
  const at = (Math.floor(size / 2) * size + Math.floor(size * 0.3)) * 4
  assert.deepEqual([...pause.subarray(at, at + 4)], [0x00, 0x6f, 0xff, 0xff])
  for (let i = 0; i < pause.length; i += 4) {
    assert.ok(pause[i + 2] <= pause[i + 3] && pause[i + 1] <= pause[i + 3] && pause[i] <= pause[i + 3], 'no colour is stronger than its alpha')
  }
})

test('thumbnail icons: the four icons are different from each other', () => {
  const seen = new Set(['play', 'pause', 'previous', 'next'].map((name) => glyphBitmap(name as 'play', 16).toString('hex')))
  assert.equal(seen.size, 4)
})
