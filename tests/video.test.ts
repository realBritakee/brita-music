import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { commandScript, parseVideoState, READ_VIDEO, sanitizeVideoCommand } from '../src/main/videoModel.ts'
import type { VideoCommand } from '../src/shared/types.ts'

interface FakeVideo {
  paused: boolean
  ended: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  readyState: number
  plays: number
  pauses: number
  play(): void
  pause(): void
}

function fakeVideo(over: Partial<FakeVideo> = {}): FakeVideo {
  const video: FakeVideo = {
    paused: true, ended: false, currentTime: 12, duration: 200, volume: 0.5, muted: false, readyState: 4, plays: 0, pauses: 0,
    play() { this.paused = false; this.plays++ },
    pause() { this.paused = true; this.pauses++ },
    ...over,
  }
  return video
}

interface Page {
  host: string
  path: string
  title: string
  videos: FakeVideo[]
  main?: FakeVideo
  next?: { clicks: number }
  prev?: { clicks: number }
}

/** Runs a script from the app in a made-up page, the way the page's own code would see it. */
function run(script: string, page: Page): unknown {
  const button = (kind: { clicks: number } | undefined) => (kind === undefined ? null : { offsetParent: {}, click() { kind.clicks++ } })
  const document = {
    title: page.title,
    querySelector(selector: string) {
      if (selector === 'video.html5-main-video') return page.main ?? null
      if (selector === '.ytp-next-button') return button(page.next)
      if (selector === '.ytp-prev-button') return button(page.prev)
      return null
    },
    querySelectorAll(selector: string) {
      return selector === 'video' ? page.videos : []
    },
  }
  return vm.runInNewContext(script, { document, location: { hostname: page.host, pathname: page.path }, getComputedStyle: () => ({ display: 'block' }) })
}

test('on another site the first loaded video is read', () => {
  const video = fakeVideo({ paused: false })
  const state = parseVideoState(run(READ_VIDEO, { host: 'example.com', path: '/clip', title: 'Clip', videos: [fakeVideo({ readyState: 0 }), video] }))
  assert.deepEqual(state, { title: 'Clip', playing: true, time: 12, duration: 200, volume: 0.5, muted: false, canNext: false, canPrevious: false })
})

test('no video on the page means no state', () => {
  assert.equal(parseVideoState(run(READ_VIDEO, { host: 'example.com', path: '/', title: 'Home', videos: [] })), null)
})

test('on YouTube only watch pages count, so the previews on the start page never take over', () => {
  const preview = fakeVideo({ paused: false })
  assert.equal(parseVideoState(run(READ_VIDEO, { host: 'www.youtube.com', path: '/', title: 'YouTube', videos: [preview], main: preview })), null)
  assert.equal(parseVideoState(run(READ_VIDEO, { host: 'www.youtube.com', path: '/results', title: 'x - YouTube', videos: [preview], main: preview })), null)
})

test('a YouTube watch page gives the cleaned title and whether next and previous exist', () => {
  const main = fakeVideo({ paused: false })
  const page: Page = { host: 'www.youtube.com', path: '/watch', title: '(3) The White Buffalo - Wish It Was True - YouTube', videos: [main], main, next: { clicks: 0 } }
  const state = parseVideoState(run(READ_VIDEO, page))
  assert.equal(state?.title, 'The White Buffalo - Wish It Was True')
  assert.equal(state?.playing, true)
  assert.equal(state?.canNext, true)
  assert.equal(state?.canPrevious, false)
})

test('commands play, pause, seek, set the volume and mute', () => {
  const video = fakeVideo()
  const page: Page = { host: 'example.com', path: '/', title: 'x', videos: [video] }
  assert.equal(run(commandScript({ type: 'toggle' }), page), true)
  assert.equal(video.plays, 1)
  assert.equal(video.paused, false)
  run(commandScript({ type: 'toggle' }), page)
  assert.equal(video.paused, true)
  run(commandScript({ type: 'pause' }), page)
  assert.equal(video.pauses, 2)
  run(commandScript({ type: 'seek', seconds: 90.5 }), page)
  assert.equal(video.currentTime, 90.5)
  run(commandScript({ type: 'volume', volume: 0.25 }), page)
  assert.deepEqual([video.volume, video.muted], [0.25, false])
  run(commandScript({ type: 'volume', volume: 0 }), page)
  assert.deepEqual([video.volume, video.muted], [0, true])
  run(commandScript({ type: 'mute' }), page)
  assert.equal(video.muted, false)
})

test('next and previous use the YouTube buttons, and previous restarts the video when there is none', () => {
  const main = fakeVideo({ currentTime: 77 })
  const next = { clicks: 0 }
  const prev = { clicks: 0 }
  const page: Page = { host: 'www.youtube.com', path: '/watch', title: 'x - YouTube', videos: [main], main, next, prev }
  run(commandScript({ type: 'next' }), page)
  run(commandScript({ type: 'previous' }), page)
  assert.deepEqual([next.clicks, prev.clicks, main.currentTime], [1, 1, 77])
  const alone: Page = { host: 'www.youtube.com', path: '/watch', title: 'x - YouTube', videos: [main], main }
  run(commandScript({ type: 'next' }), alone)
  run(commandScript({ type: 'previous' }), alone)
  assert.equal(main.currentTime, 0)
})

test('a command without a video answers false and does nothing', () => {
  assert.equal(run(commandScript({ type: 'toggle' }), { host: 'example.com', path: '/', title: 'x', videos: [] }), false)
})

test('the page answer is cleaned and bad answers mean no video', () => {
  assert.equal(parseVideoState(null), null)
  assert.equal(parseVideoState('video'), null)
  assert.equal(parseVideoState({ playing: true }), null)
  const state = parseVideoState({ title: 'T', playing: 'yes', time: -4, duration: NaN, volume: 7, muted: 1, canNext: true })
  assert.deepEqual(state, { title: 'T', playing: false, time: 0, duration: 0, volume: 1, muted: false, canNext: true, canPrevious: false })
})

test('only known commands with sane numbers pass', () => {
  const ok: VideoCommand[] = [{ type: 'toggle' }, { type: 'pause' }, { type: 'mute' }, { type: 'next' }, { type: 'previous' }, { type: 'seek', seconds: 5 }, { type: 'volume', volume: 0.4 }]
  for (const command of ok) assert.deepEqual(sanitizeVideoCommand(command), command)
  assert.deepEqual(sanitizeVideoCommand({ type: 'volume', volume: 9 }), { type: 'volume', volume: 1 })
  assert.equal(sanitizeVideoCommand({ type: 'seek', seconds: -1 }), null)
  assert.equal(sanitizeVideoCommand({ type: 'seek', seconds: 'x' }), null)
  assert.equal(sanitizeVideoCommand({ type: 'eval', code: 'alert(1)' }), null)
  assert.equal(sanitizeVideoCommand('toggle'), null)
  assert.equal(sanitizeVideoCommand(null), null)
})
