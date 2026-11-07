// Drives the real built app with test songs, muted. Run with: npm run test:app
// Step 4 checks (live folders, missing folder, new playlist) change the test folders from outside the
// app, the way Windows Explorer would, and wait for the app to notice.
// Run it against the packed program with: BRITA_MAIN=<path to app.asar>/out/main/index.js electron tests/app-check.cjs (then again with --again).
// It runs twice: the first start builds a library from test songs, the second start (--again) is a
// real restart with the same data folder. It answers the folder dialog itself and prints PASS or FAIL per check.

const electron = require('electron')
const { app, BrowserWindow, dialog, globalShortcut, net } = electron
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { makeFlac, makeMp3, makeOpus, makePng, makeWav } = require('./make-audio.cjs')

const again = process.argv.includes('--again')
// Step 15: a second copy of the program, started by the check itself, must hand over to the first one and quit.
const secondCopy = process.argv.includes('--second')
const base = path.join(os.tmpdir(), 'brita-app-check')
const music = path.join(base, 'Musik')
const big = path.join(base, 'Big')
const second = path.join(base, 'Second')
const cacheFile = path.join(base, 'userData', 'library-cache.json')
const settingsFile = path.join(base, 'userData', 'settings.json')
const screenshot = process.env.BRITA_SCREENSHOT
const buffalo = 'The White Buffalo'
let failures = 0
let chosen = music

// The app keeps its remembered library here, never in the real data folder of the person running the check.
if (!again && !secondCopy) fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(base, { recursive: true })
app.setPath('userData', path.join(base, 'userData'))

// Step 15: the check cannot click a real tray icon, so it watches the icons the app makes (and the menu each one gets).
const trays = []
class WatchedTray extends electron.Tray {
  constructor(...args) {
    super(...args)
    this.menu = null
    this.tip = ''
    // Electron's methods may sit on the object itself, so they are wrapped here instead of overridden in the class.
    const setMenu = this.setContextMenu.bind(this)
    const setTip = this.setToolTip.bind(this)
    this.setContextMenu = (menu) => {
      this.menu = menu
      setMenu(menu)
    }
    this.setToolTip = (text) => {
      this.tip = text
      setTip(text)
    }
    trays.push(this)
  }
}

// Step 16: the same for the taskbar thumbnail buttons. Every call of the app is kept, with whether Windows took it.
const thumbCalls = []
class WatchedWindow extends electron.BrowserWindow {
  constructor(...args) {
    super(...args)
    const setButtons = this.setThumbarButtons.bind(this)
    this.setThumbarButtons = (buttons) => {
      const ok = setButtons(buttons)
      thumbCalls.push({ buttons, ok })
      return ok
    }
  }
}

// Electron's own module cannot be changed, so the app is handed a copy of it whose Tray and BrowserWindow are the watched ones.
const Module = require('node:module')
const loadModule = Module._load
const watched = { Tray: WatchedTray, BrowserWindow: WatchedWindow }
const watchedElectron = new Proxy(electron, { get: (target, name) => (name in watched ? watched[name] : target[name]) })
Module._load = function (request, ...rest) {
  const loaded = loadModule.call(this, request, ...rest)
  return request === 'electron' && loaded === electron ? watchedElectron : loaded
}

// The check window may lie behind other windows. Chromium then calls the page "hidden" and never loads lazy
// pictures (the covers), so the check turns that detection off. Only this test run is affected, not the app.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// Answered from the very start, so the real folder window can never open during a check.
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })

function report(ok, name, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function put(relative, data) {
  const full = path.join(music, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
  return full
}

function makeBigFolder() {
  for (let p = 0; p < 200; p++) {
    const dir = path.join(big, `Playlist ${p}`)
    fs.mkdirSync(dir, { recursive: true })
    for (let s = 0; s < 100; s++) fs.writeFileSync(path.join(dir, `Song ${s}.mp3`), '')
  }
}

// A check that throws counts as one failure with its name, and the run goes on.
async function guard(name, work) {
  try {
    await work()
  } catch (error) {
    const where = String(error && error.stack ? error.stack : '').split(/\r?\n/).find((line) => line.includes('app-check.cjs')) ?? ''
    report(false, `${name} crashed`, `${String(error && error.message ? error.message : error).split(/\r?\n/)[0]} ${where.trim()}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(page, expression, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await page(expression)) return true
    await sleep(100)
  }
  return false
}

const clickSong = (title) => `[...document.querySelectorAll('.song')].find((row) => row.querySelector('.song-title').textContent === ${JSON.stringify(title)}).click()`
const clickNav = (name) => `[...document.querySelectorAll('.s-item')].find((item) => item.textContent === ${JSON.stringify(name)}).click()`
const clocks = `[...document.querySelectorAll('.clock')].map((clock) => clock.textContent)`
const titles = `[...document.querySelectorAll('.song-title')].map((title) => title.textContent)`
const seconds = (text) => text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)

// What a list row shows: its texts, and whether its cover picture has loaded.
const rowOf = (title) => `(() => {
  const row = [...document.querySelectorAll('.song')].find((item) => item.querySelector('.song-title').textContent === ${JSON.stringify(title)})
  if (!row) return null
  const img = row.querySelector('img')
  return {
    artist: row.querySelector('.song-artist').textContent,
    album: row.querySelector('.song-album').textContent,
    length: row.querySelector('.song-length').textContent,
    cover: img ? img.complete && img.naturalWidth > 0 : false,
    hasImg: img !== null,
  }
})()`

async function checkFileType(page, title, label) {
  await page(clickSong(title))
  const started = await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause' && document.querySelector('.clock').textContent !== '0:00'`)
  const error = await page(`document.querySelector('.now-error')?.textContent ?? ''`)
  report(started && error === '', `${label} plays`, error)
}

async function checkSeek(page) {
  await page(clickSong('tone-wav'))
  await waitFor(page, `document.querySelectorAll('.clock')[1].textContent === '0:30'`)
  await page(`(() => {
    const input = document.querySelector('.seek input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '20')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(1500)
  const [now, total] = await page(clocks)
  report(seconds(now) >= 20 && seconds(now) <= 24, 'seek bar jumps and playback continues there', `${now} of ${total}`)
}

async function checkPause(page) {
  await page(`document.querySelector('.play').click()`)
  await sleep(300)
  const before = (await page(clocks))[0]
  await sleep(1500)
  const after = (await page(clocks))[0]
  const label = await page(`document.querySelector('.play').getAttribute('aria-label')`)
  report(label === 'Play' && before === after, 'pause stops the clock', `${before} then ${after}`)
  await page(`document.querySelector('.play').click()`)
  const resumed = await waitFor(page, `document.querySelectorAll('.clock')[0].textContent !== ${JSON.stringify(after)}`)
  report(resumed, 'play continues after pause')
}

async function checkBadFiles(page) {
  for (const [title, label] of [['damaged', 'damaged file'], ['old-format', 'WMA file']]) {
    await page(clickSong(title))
    const shown = await waitFor(page, `(document.querySelector('.now-error')?.textContent ?? '').includes('cannot be played')`)
    report(shown, `${label} shows a clear message`)
  }
}

async function checkAccess(wavPath) {
  const url = (file) => `brita-media://song/${encodeURIComponent(file)}`
  const ranged = await net.fetch(url(wavPath), { headers: { Range: 'bytes=100-199' } })
  report(ranged.status === 206 && (await ranged.arrayBuffer()).byteLength === 100, 'song server answers byte ranges', `status ${ranged.status}`)

  const outside = path.join(base, 'outside.mp3')
  fs.writeFileSync(outside, makeMp3())
  const refused = await net.fetch(url(outside))
  report(refused.status === 403, 'a song outside the added folders is refused', `status ${refused.status}`)
  const text = path.join(music, 'notes.txt')
  const refusedText = await net.fetch(url(text))
  report(refusedText.status === 403, 'a non-music file in the folder is refused', `status ${refusedText.status}`)

  const coverUrl = (file) => `brita-media://cover/${encodeURIComponent(file)}`
  const cover = await net.fetch(coverUrl(path.join(music, buffalo, 'Tagged', 'with-tags.mp3')))
  report(cover.status === 200 && cover.headers.get('content-type') === 'image/png', 'a cover is served from inside a song', `status ${cover.status}`)
  const noCover = await net.fetch(coverUrl(wavPath))
  report(noCover.status === 404, 'a song without a cover answers "no cover"', `status ${noCover.status}`)
  const coverOutside = await net.fetch(coverUrl(outside))
  report(coverOutside.status === 403, 'covers are only served for songs in the added folders', `status ${coverOutside.status}`)
}

async function checkLibraryScreen(page) {
  const playlists = await page(`[...document.querySelectorAll('.s-item')].map((item) => item.textContent)`)
  report(JSON.stringify(playlists) === JSON.stringify(['All songs', 'Favorites', 'Recently played', 'Most played', 'Empty Playlist', 'The White Buffalo']), 'sidebar shows All songs, the three automatic lists and the playlists', playlists.join(', '))

  // Nothing has been played yet: both history lists are empty and say so, and no history file exists.
  for (const name of ['Recently played', 'Most played']) {
    await page(clickNav(name))
    const shown = await waitFor(page, `${emptyText}.includes('Nothing played yet')`, 8000)
    report(shown && (await page(viewTitle)) === name && (await page(titles)).length === 0, `before anything is played, ${name} is empty and says so`, await page(emptyText))
  }
  report(!fs.existsSync(historyFile), 'nothing is written to history.json before a song is played')
  await page(clickNav('All songs'))
  await sleep(100)

  const all = await page(titles)
  report(all.includes('loose') && all.includes('nested') && !all.includes('notes'), 'All songs lists everything, deep or loose, and no other files', `${all.length} songs`)

  await page(clickNav('The White Buffalo'))
  await sleep(100)
  const buffaloSongs = await page(titles)
  report(buffaloSongs.length === all.length - 1 && !buffaloSongs.includes('loose') && buffaloSongs.includes('nested'), 'a playlist shows only its own songs', buffaloSongs.join(', '))

  await page(clickNav('Empty Playlist'))
  await sleep(100)
  report((await page(`document.querySelector('.empty')?.textContent ?? ''`)).includes('No music files'), 'an empty playlist says so')
  await page(clickNav('The White Buffalo'))
}

const lengthLooksRight = (text) => text === '0:29' || text === '0:30'

async function checkDetails(page) {
  const read = await waitFor(page, `${rowOf('Wild Hunt')} !== null && ${rowOf('Opus Song')} !== null`)
  report(read, 'song titles from the tags replace the file names')

  const mp3 = await page(rowOf('Wild Hunt'))
  report(mp3?.artist === 'Björk' && mp3?.album === 'Debut' && lengthLooksRight(mp3?.length), 'MP3 shows artist, album and length', JSON.stringify(mp3))
  const flac = await page(rowOf('Flac Song'))
  report(flac?.artist === 'Sigur Rós' && flac?.album === 'Ágætis byrjun' && lengthLooksRight(flac?.length), 'FLAC shows artist, album and length', JSON.stringify(flac))
  const opus = await page(rowOf('Opus Song'))
  report(opus?.artist === 'Someone' && opus?.album === 'Else' && lengthLooksRight(opus?.length), 'Opus shows artist, album and length', JSON.stringify(opus))

  const plain = await page(rowOf('tone-mp3'))
  report(plain?.artist === '' && plain?.album === '' && lengthLooksRight(plain?.length), 'a song without tags keeps its file name and shows its length', JSON.stringify(plain))
  const wav = await page(rowOf('tone-wav'))
  report(wav?.length === '0:30', 'WAV shows its length', wav?.length)
  const damaged = await page(rowOf('damaged'))
  report(damaged !== null && damaged.length === '' && damaged.artist === '', 'a damaged file keeps its file name and shows no length', JSON.stringify(damaged))
}

async function checkCovers(page) {
  const embedded = await waitFor(page, `${rowOf('Wild Hunt')}?.cover === true`)
  const seen = embedded ? '' : await page(`(() => {
    const img = [...document.querySelectorAll('.song')].find((item) => item.querySelector('.song-title').textContent === 'Wild Hunt')?.querySelector('img')
    return JSON.stringify({ visibility: document.visibilityState, focus: document.hasFocus(), complete: img?.complete, width: img?.naturalWidth, top: img?.getBoundingClientRect().top, inner: innerHeight })
  })()`)
  report(embedded, 'a cover inside the song shows in the list', seen)
  const folder = await waitFor(page, `${rowOf('nested')}?.cover === true`)
  report(folder, 'a cover picture in the song folder shows in the list')
  const none = await waitFor(page, `${rowOf('tone-wav')}?.hasImg === false`)
  report(none, 'a song without a cover shows the placeholder')

  await page(clickSong('Wild Hunt'))
  const player = await waitFor(page, `document.querySelector('.now-cover img')?.complete && document.querySelector('.now-cover img').naturalWidth > 0`)
  const nowTitle = await page(`document.querySelector('.now-title')?.textContent`)
  const nowArtist = await page(`document.querySelector('.now-artist')?.textContent`)
  report(player && nowTitle === 'Wild Hunt' && nowArtist === 'Björk', 'the player shows cover, title and artist', `${nowTitle} / ${nowArtist}`)
}

async function waitForSavedLibrary() {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (cache.library.folders.length === 1 && cache.library.songs.some((song) => song.title === 'Wild Hunt')) return true
    } catch {
      // Not written yet.
    }
    await sleep(200)
  }
  return false
}

// ---------- Step 3: player controls ----------

const nowTitle = `(document.querySelector('.now-title')?.textContent ?? '')`
const button = (label) => `document.querySelector('button[aria-label=${JSON.stringify(label)}]')`
const press = (label) => `${button(label)}.click()`
const labelOf = (label) => `${button(label)}?.getAttribute('aria-label')`

function setSlider(page, selector, value) {
  return page(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(String(value))})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
}

// The audio element lives inside the app. The debugger lets the check look at it without a test hook in the app.
async function audioState(window) {
  const debug = window.webContents.debugger
  if (!debug.isAttached()) debug.attach('1.3')
  const proto = await debug.sendCommand('Runtime.evaluate', { expression: 'HTMLAudioElement.prototype' })
  const found = await debug.sendCommand('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId })
  const out = await debug.sendCommand('Runtime.callFunctionOn', {
    objectId: found.objects.objectId,
    functionDeclaration: 'function () { return this.map((a) => ({ volume: a.volume, muted: a.muted, paused: a.paused, src: a.src, time: a.currentTime, sink: a.sinkId })) }',
    returnByValue: true,
  })
  return out.result.value[0]
}

async function playAndWait(page, title) {
  await page(clickSong(title))
  return waitFor(page, `${nowTitle} === ${JSON.stringify(title)} && document.querySelector('.play').getAttribute('aria-label') === 'Pause'`)
}

async function seekNearEnd(page, before = 1.5) {
  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  const total = Number(await page(`document.querySelector('.seek input').max`))
  await setSlider(page, '.seek input', total - before)
}

async function checkNextPrevious(page) {
  const list = await page(titles)
  const at = list.indexOf('tone-flac')
  await playAndWait(page, 'tone-flac')
  await page(press('Next song'))
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(list[at + 1])}`), 'next plays the following song of the list', list[at + 1])
  await page(press('Previous song'))
  report(await waitFor(page, `${nowTitle} === 'tone-flac'`), 'previous, soon after a song starts, goes back one song')

  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  await setSlider(page, '.seek input', 20)
  await sleep(500)
  await page(press('Previous song'))
  await sleep(500)
  const [now] = await page(clocks)
  report((await page(nowTitle)) === 'tone-flac' && seconds(now) < 3, 'previous, late in a song, restarts that song', now)

  await playAndWait(page, list[list.length - 1])
  await page(press('Next song'))
  await sleep(300)
  report((await page(nowTitle)) === list[list.length - 1], 'next at the end of the list stays put when repeat is off')
}

async function checkAutoplay(page) {
  const list = await page(titles)
  const after = list.slice(list.indexOf('nested') + 1).find((title) => title !== 'damaged' && title !== 'old-format')
  await playAndWait(page, 'nested')
  await seekNearEnd(page)
  const moved = await waitFor(page, `${nowTitle} === ${JSON.stringify(after)}`, 8000)
  const error = await page(`document.querySelector('.now-error')?.textContent ?? ''`)
  report(moved && error === '', 'a song that ends is followed by the next one, passing over files that cannot play', `landed on ${await page(nowTitle)}`)
  const notice = await page(`document.querySelector('.now-notice')?.textContent ?? ''`)
  report(notice.includes('Skipped'), 'a skipped file is announced', notice)
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`), 'playback continues after the skipped files')
}

async function checkRepeat(page) {
  const list = await page(titles)
  const labels = []
  for (let i = 0; i < 3; i++) {
    await page(`document.querySelector('button[aria-label^="Repeat"]').click()`)
    await sleep(50)
    labels.push(await page(`document.querySelector('button[aria-label^="Repeat"]').getAttribute('aria-label')`))
  }
  report(labels.join(' / ') === 'Repeat: all / Repeat: one / Repeat: off', 'the repeat button cycles off, all, one, off', labels.join(' / '))

  const last = list[list.length - 1]
  await playAndWait(page, last)
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`)
  await seekNearEnd(page)
  const wrapped = await waitFor(page, `${nowTitle} === ${JSON.stringify(list[0])}`, 8000)
  report(wrapped, 'repeat all: after the last song the list starts again', `landed on ${await page(nowTitle)}`)

  await playAndWait(page, last)
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // all -> one
  await seekNearEnd(page)
  await sleep(3500)
  const state = await audioState(window0)
  report((await page(nowTitle)) === last && !state.paused && state.time < 6, 'repeat one: the same song plays again', `${await page(nowTitle)} at ${state.time.toFixed(1)} s`)
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // one -> off
}

async function checkShuffle(page) {
  const list = await page(titles)
  await page(press('Shuffle'))
  await sleep(100)
  report((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'true', 'the shuffle button shows that it is on')
  await playAndWait(page, list[0])
  const played = [await page(nowTitle)]
  for (let i = 1; i < list.length; i++) {
    await page(press('Next song'))
    await sleep(120)
    played.push(await page(nowTitle))
  }
  const sameSongs = JSON.stringify([...played].sort()) === JSON.stringify([...list].sort())
  report(played[0] === list[0] && sameSongs && JSON.stringify(played) !== JSON.stringify(list), 'shuffle plays every song once, in a different order', played.join(', '))
  await page(press('Shuffle'))
}

// The Play and Shuffle buttons in the list header.
const headButton = (name) => `[...document.querySelectorAll('.head-actions button')].find((item) => item.textContent.trim() === ${JSON.stringify(name)})`

async function checkPlayList(page) {
  const list = await page(titles)
  report((await page(`[...document.querySelectorAll('.head-actions button')].map((item) => item.textContent.trim()).join(',')`)) === 'Play,Shuffle', 'the list header has a Play and a Shuffle button')

  await page(`${headButton('Shuffle')}.click()`)
  await sleep(200)
  report((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'true', 'the header Shuffle button turns the shuffle button in the player bar on')
  const played = [await page(nowTitle)]
  for (let i = 1; i < list.length; i++) {
    await page(press('Next song'))
    await sleep(120)
    played.push(await page(nowTitle))
  }
  const sameSongs = JSON.stringify([...played].sort()) === JSON.stringify([...list].sort())
  report(sameSongs, 'header Shuffle plays every song of the list once', played.join(', '))

  await page(`${headButton('Play')}.click()`)
  await sleep(200)
  report((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'false', 'the header Play button turns the shuffle off')
  report((await page(nowTitle)) === list[0], 'header Play starts with the first song of the list', await page(nowTitle))
  const inOrder = await nextTitles(page, list.length - 1)
  report(JSON.stringify(inOrder) === JSON.stringify(list.slice(1)), 'header Play plays the list in order', inOrder.join(', '))
}

// Step 20: the Download page with its browser view. A local test site stands in for youtube.com; the app is told to
// accept only the host 127.0.0.1 for this (the start page address is set at the top of the run). "localhost" is a
// different host to the app, so it plays the part of "any other website".
function silentWav() {
  const samples = 8000 * 5
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + samples, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(samples, 40)
  return Buffer.concat([header, Buffer.alloc(samples, 128)])
}

async function startTestSite() {
  const seen = []
  const clip = silentWav()
  const server = http.createServer((request, response) => {
    seen.push(`${request.headers.host} ${request.url}`)
    if (request.url === '/clip.wav') {
      response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': clip.length })
      response.end(clip)
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end(`<title>Test site ${request.url}</title><body><a id="two" href="/two">two</a>
      <a id="blocked" href="http://localhost:${server.address().port}/blocked">other site</a>
      <video id="v" src="/clip.wav" loop></video></body>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, seen, port: server.address().port }
}

const downloadLink = `[...document.querySelectorAll('.s-link')].find((item) => item.textContent === 'Download')`

async function checkDownloadPage(page, window) {
  const site = await startTestSite()
  try {
    const root = `http://127.0.0.1:${site.port}`
    report(await page(`document.querySelector('.browse') === null`), 'the Download page is closed at first')
    report((await page(`${downloadLink}.textContent`)) === 'Download', 'the sidebar has a Download entry')
    await page(`${downloadLink}.click()`)
    report(await waitFor(page, `document.querySelector('.browse') !== null`, 3000), 'the Download entry opens the Download page')
    const viewOf = () => window.contentView.children.find((child) => child.webContents !== undefined)
    report(await until(() => viewOf() !== undefined, 5000), 'the page puts a browser view into the window')
    const view = viewOf()
    const contents = view.webContents
    contents.setAudioMuted(true)
    report(view.getVisible(), 'the browser view is visible on the Download page')
    const box = await page(`(() => { const r = document.querySelector('.browse-box').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } })()`)
    const placed = view.getBounds()
    const closeEnough = ['x', 'y', 'width', 'height'].every((key) => Math.abs(placed[key] - box[key]) <= 1)
    report(closeEnough, 'the browser view lies exactly over the page area', `view ${JSON.stringify(placed)} | area ${JSON.stringify(box)}`)

    await contents.loadURL(`${root}/`)
    report(await waitFor(page, `document.querySelector('.browse-address').value === ${JSON.stringify(`${root}/`)}`, 5000), 'the address bar shows the page the view is on')
    report(await page(`document.querySelector('button[aria-label="Back"]').disabled`), 'Back is switched off at the first page')

    await contents.executeJavaScript(`document.getElementById('two').click()`, true)
    report(await waitFor(page, `document.querySelector('.browse-address').value === ${JSON.stringify(`${root}/two`)}`, 5000), 'a link inside the allowed host opens in the view')
    report(await waitFor(page, `!document.querySelector('button[aria-label="Back"]').disabled`, 3000), 'Back is switched on after a second page')
    await page(press('Back'))
    report(await waitFor(page, `document.querySelector('.browse-address').value === ${JSON.stringify(`${root}/`)}`, 5000), 'Back goes to the first page')
    report(await waitFor(page, `!document.querySelector('button[aria-label="Forward"]').disabled`, 3000), 'Forward is switched on after going back')
    await page(press('Forward'))
    report(await waitFor(page, `document.querySelector('.browse-address').value === ${JSON.stringify(`${root}/two`)}`, 5000), 'Forward goes to the second page')

    // Other websites do nothing: no click, no pop-up and no redirect reaches them.
    await contents.loadURL(`${root}/`)
    await contents.executeJavaScript(`document.getElementById('blocked').click()`, true)
    await sleep(800)
    report(contents.getURL() === `${root}/` && !site.seen.some((line) => line.startsWith('localhost')), 'a link to another website does nothing', `${contents.getURL()} | ${site.seen.join(', ')}`)
    await contents.executeJavaScript(`window.open('http://localhost:${site.port}/popup')`, true)
    await sleep(800)
    report(!site.seen.some((line) => line.startsWith('localhost')) && contents.getURL() === `${root}/`, 'a pop-up to another website does nothing')
    await contents.executeJavaScript(`window.open('${root}/three')`, true)
    report(await waitFor(page, `document.querySelector('.browse-address').value === ${JSON.stringify(`${root}/three`)}`, 5000), 'a pop-up to an allowed page opens in the same view')
    report(liveWindows().length === 1, 'no extra window was opened', String(liveWindows().length))

    // A playing video stops when the page is left, and the view keeps its page when Chris returns.
    await contents.loadURL(`${root}/`)
    await contents.executeJavaScript(`document.getElementById('v').play()`, true)
    report(await until(async () => (await contents.executeJavaScript(`!document.getElementById('v').paused`)) === true, 4000), 'the test video plays in the view')
    await page(clickNav('All songs'))
    report(await waitFor(page, `document.querySelector('.browse') === null`, 3000), 'another page closes the Download page')
    report(!view.getVisible(), 'the browser view is hidden when the page is left')
    report(await until(async () => (await contents.executeJavaScript(`document.getElementById('v').paused`)) === true, 3000), 'the video is paused when the page is left')
    await page(`${downloadLink}.click()`)
    report(await until(() => view.getVisible(), 3000), 'the browser view comes back with the page')
    report(contents.getURL() === `${root}/` && window.contentView.children.filter((child) => child.webContents !== undefined).length === 1, 'it is the same view on the same page, not a new one', contents.getURL())
  } finally {
    await page(clickNav('All songs'))
    site.server.close()
  }
}

// Step 9: the "Playing next" panel.
const queueRows = `[...document.querySelectorAll('.queue-row .queue-song')].map((row) => row.textContent)`

async function nextTitles(page, count) {
  const played = []
  for (let i = 0; i < count; i++) {
    await page(press('Next song'))
    await sleep(120)
    played.push(await page(nowTitle))
  }
  return played
}

async function checkQueue(page) {
  const list = await page(titles)
  report(await page(`document.querySelector('.queue') === null`), 'the queue panel is closed at first')

  await playAndWait(page, list[0])
  await page(press('Playing next'))
  report(await waitFor(page, `document.querySelector('.queue') !== null`, 3000), 'the player bar button opens the queue panel')
  report((await page(`${button('Playing next')}.getAttribute('aria-pressed')`)) === 'true', 'the queue button shows that the panel is open')
  report(JSON.stringify(await page(queueRows)) === JSON.stringify(list.slice(1)), 'in list order the panel shows the songs after the current one', (await page(queueRows)).join(', '))
  const countText = await page(`document.querySelector('.queue-title p').textContent`)
  report(countText === `${list.length - 1} songs`, 'the panel says how many songs follow', countText)

  // With shuffle on, the panel must show the order the songs then really play in.
  await page(press('Shuffle'))
  await sleep(150)
  const shown = await page(queueRows)
  const played = await nextTitles(page, shown.length)
  report(shown.length === list.length - 1 && JSON.stringify(shown) === JSON.stringify(played), 'with shuffle on, the panel shows the order the songs then play in', `shown ${shown.join(', ')} | played ${played.join(', ')}`)
  await page(press('Shuffle'))
  await sleep(150)

  // Removing a song skips it.
  await playAndWait(page, list[0])
  await page(press(`Remove ${list[2]} from the queue`))
  await sleep(150)
  const afterRemove = await page(queueRows)
  report(JSON.stringify(afterRemove) === JSON.stringify(list.slice(1).filter((_, i) => i !== 1)), 'removing a song takes it out of the panel', afterRemove.join(', '))
  const skipped = await nextTitles(page, 2)
  report(skipped[0] === list[1] && skipped[1] === list[3], 'a removed song is skipped when the songs play on', skipped.join(', '))

  // "Play next" moves a song right behind the current one.
  await playAndWait(page, list[0])
  const last = list[list.length - 1]
  await page(press(`Play ${last} next`))
  await sleep(150)
  const afterMove = await page(queueRows)
  report(afterMove[0] === last && afterMove.length === list.length - 1, 'play next puts the song first in the panel and keeps every song once', afterMove.join(', '))
  const order = await nextTitles(page, 2)
  report(order[0] === last && order[1] === list[1], 'a song sent to play next plays right after the current one', order.join(', '))

  await page(press('Playing next'))
  report(await waitFor(page, `document.querySelector('.queue') === null`, 3000), 'the queue button closes the panel again')
}

// Step 10: the right-click menu of a song.
const revealed = []
const samePath = (a, b) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase()

const openMenu = (title, x = 300, y = 200) => `(() => {
  const row = [...document.querySelectorAll('.song')].find((item) => item.querySelector('.song-title').textContent === ${JSON.stringify(title)})
  return row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y} }))
})()`
const menuLabels = `[...document.querySelectorAll('.ctx-item')].map((item) => item.textContent)`
const menuDisabled = `[...document.querySelectorAll('.ctx-item:disabled')].map((item) => item.textContent)`
const menuOpen = `document.querySelector('.ctx-menu') !== null`
const menuGone = `document.querySelector('.ctx-menu') === null`
const clickMenu = (label) => `[...document.querySelectorAll('.ctx-item')].find((item) => item.textContent === ${JSON.stringify(label)}).click()`
const focusedText = `(document.activeElement?.textContent ?? '')`
const keyOnFocused = (init) => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${JSON.stringify(init)})))`
const focusedSongIs = (title) => `document.activeElement?.classList.contains('song') && document.activeElement.querySelector('.song-title').textContent === ${JSON.stringify(title)}`

async function showMenu(page, title, x, y) {
  await page(openMenu(title, x, y))
  return waitFor(page, menuOpen, 3000)
}

async function until(test, timeout = 3000) {
  for (let end = Date.now() + timeout; Date.now() < end; await sleep(100)) {
    if (await test()) return true
  }
  return Boolean(await test())
}

async function checkSongMenu(page) {
  const { clipboard, shell } = require('electron')
  const savedClipboard = await clipboard.readText()
  const realReveal = shell.showItemInFolder
  // Opening a real Explorer window is not wanted in a check; the call is recorded instead.
  shell.showItemInFolder = (file) => { revealed.push(file) }
  try {
    await songMenuChecks(page, clipboard)
  } finally {
    shell.showItemInFolder = realReveal
    // Putting the old text back is best effort (Electron cannot write some texts back); it must not hide the check's own error.
    try {
      if (savedClipboard === '') clipboard.clear()
      else await clipboard.writeText(savedClipboard)
    } catch (error) {
      console.log(`NOTE  the clipboard text from before the check could not be put back (${error.message.split(/\r?\n/)[0]})`)
    }
  }
}

async function songMenuChecks(page, clipboard) {
  const hunt = path.join(music, buffalo, 'Tagged', 'with-tags.mp3')
  await page(clickNav('The White Buffalo'))
  await sleep(100)
  const list = await page(titles)
  await playAndWait(page, list[0])

  report(await showMenu(page, 'Wild Hunt'), 'right-click on a song opens the menu')
  const labels = await page(menuLabels)
  report(JSON.stringify(labels) === JSON.stringify(['Play next', 'Add to queue', 'Show in Explorer', 'Copy path', 'Go to artist', 'Go to album', 'Add to favorites']), 'the menu has the seven entries in order', labels.join(', '))
  report((await page(`document.querySelectorAll('.ctx-menu').length`)) === 1 && (await page(`document.querySelector('.ctx-menu').getAttribute('role')`)) === 'menu', 'one menu with the menu role')
  report((await page(focusedText)) === 'Play next', 'the first entry has the focus')
  report((await page(menuDisabled)).length === 0, 'a normal song has every entry enabled')

  // Add to queue: the song goes to the end of the play order, once.
  await page(clickMenu('Add to queue'))
  report(await waitFor(page, menuGone, 3000), 'choosing an entry closes the menu')
  report(await page(focusedSongIs('Wild Hunt')), 'the focus goes back to the song row')
  await page(press('Playing next'))
  await waitFor(page, `document.querySelector('.queue') !== null`, 3000)
  const queued = await page(queueRows)
  report(queued.length === list.length - 1 && queued[queued.length - 1] === 'Wild Hunt' && queued.filter((title) => title === 'Wild Hunt').length === 1, 'add to queue puts the song last in the panel, once', queued.join(', '))

  // Play next: the song plays right after the current one.
  await showMenu(page, 'Opus Song')
  await page(clickMenu('Play next'))
  await waitFor(page, menuGone, 3000)
  await sleep(150)
  const afterNext = await page(queueRows)
  report(afterNext[0] === 'Opus Song' && afterNext.length === list.length - 1, 'play next puts the song first in the panel', afterNext.join(', '))
  await page(press('Next song'))
  await sleep(150)
  report((await page(nowTitle)) === 'Opus Song', 'the song from the menu plays right after the current one')
  await page(press('Playing next'))

  // The playing song cannot be queued behind itself.
  await showMenu(page, 'Opus Song')
  const playingOff = await page(menuDisabled)
  report(JSON.stringify(playingOff) === JSON.stringify(['Play next', 'Add to queue']), 'the playing song has Play next and Add to queue switched off', playingOff.join(', '))
  report((await page(focusedText)) === 'Show in Explorer', 'the focus skips switched-off entries')
  await page(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  report(await waitFor(page, menuGone, 3000), 'a click outside closes the menu')

  // Show in Explorer and Copy path.
  await showMenu(page, 'Wild Hunt')
  await page(clickMenu('Show in Explorer'))
  const shown = await until(() => revealed.length === 1)
  report(shown && samePath(revealed[0], hunt), 'Show in Explorer opens the folder with this song selected', revealed[0])
  await showMenu(page, 'Wild Hunt')
  await page(clickMenu('Copy path'))
  let onClipboard = ''
  const copied = await until(async () => {
    onClipboard = await clipboard.readText()
    return onClipboard !== '' && fs.existsSync(onClipboard) && samePath(onClipboard, hunt)
  })
  report(copied, 'Copy path puts the file path on the clipboard', onClipboard)

  // The main side only acts on songs of the added folders.
  await clipboard.writeText('unchanged')
  const outside = path.join(base, 'outside.mp3')
  const refused = await page(`Promise.all([window.brita.showInFolder(${JSON.stringify(outside)}), window.brita.copyPath(${JSON.stringify(outside)}), window.brita.copyPath(${JSON.stringify(process.execPath)}), window.brita.showInFolder(42)])`)
  report(refused.every((answer) => answer === false) && (await clipboard.readText()) === 'unchanged' && revealed.length === 1, 'files outside the music folders are refused', JSON.stringify(refused))
  const gone = await page(`window.brita.showInFolder(${JSON.stringify(path.join(music, buffalo, 'not-there.mp3'))})`)
  report(gone === false && revealed.length === 1, 'a song file that is gone is not opened', String(gone))

  // Go to artist and album fill the search box.
  await showMenu(page, 'Wild Hunt')
  await page(clickMenu('Go to artist'))
  await waitFor(page, `document.querySelector('#song-search')?.value === 'Björk'`, 3000)
  report((await page(`document.querySelector('#song-search').value`)) === 'Björk' && same(await page(titles), ['Wild Hunt']), 'Go to artist searches for the artist', (await page(titles)).join(', '))
  report((await page(`document.querySelector('.view-head h1').textContent`)) === 'All songs', 'Go to artist looks through all songs')
  await search(page, '')
  await sleep(100)
  await showMenu(page, 'Wild Hunt')
  await page(clickMenu('Go to album'))
  await waitFor(page, `document.querySelector('#song-search')?.value === 'Debut'`, 3000)
  report(same(await page(titles), ['Wild Hunt']), 'Go to album searches for the album', (await page(titles)).join(', '))
  await search(page, '')
  await page(clickNav('The White Buffalo'))
  await sleep(100)

  // A song without tags has nothing to go to.
  await showMenu(page, 'tone-mp3')
  const noTags = await page(menuDisabled)
  report(JSON.stringify(noTags) === JSON.stringify(['Go to artist', 'Go to album']), 'a song without artist and album has the two Go to entries switched off', noTags.join(', '))

  // Keyboard and closing.
  await page(keyOnFocused({ key: 'ArrowDown' }))
  const afterDown = await page(focusedText)
  await page(keyOnFocused({ key: 'ArrowUp' }))
  report(afterDown === 'Add to queue' && (await page(focusedText)) === 'Play next', 'arrow keys move through the entries', afterDown)
  const playLabel = `document.querySelector('.play').getAttribute('aria-label')`
  const before = await page(playLabel)
  const spaceTaken = await page(`!document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }))`)
  report(!spaceTaken && (await page(playLabel)) === before, 'the space bar in the menu does not pause the music')
  await page(keyOnFocused({ key: 'Escape' }))
  report(await waitFor(page, menuGone, 3000), 'Escape closes the menu')
  report(await page(focusedSongIs('tone-mp3')), 'the focus goes back to the song row after Escape')

  await showMenu(page, 'tone-mp3')
  await showMenu(page, 'Wild Hunt')
  report((await page(`document.querySelectorAll('.ctx-menu').length`)) === 1, 'a second right-click moves the menu instead of opening another')
  await page(`window.dispatchEvent(new Event('resize'))`)
  report(await waitFor(page, menuGone, 3000), 'resizing the window closes the menu')

  // Near the corner the menu stays on screen.
  await showMenu(page, 'Wild Hunt', 100000, 100000)
  const box = await page(`(() => { const r = document.querySelector('.ctx-menu').getBoundingClientRect(); return { right: r.right, bottom: r.bottom, left: r.left, top: r.top, w: innerWidth, h: innerHeight } })()`)
  report(box.right <= box.w && box.bottom <= box.h && box.left >= 0 && box.top >= 0, 'a menu opened at the edge of the window stays inside it', JSON.stringify(box))
  await page(keyOnFocused({ key: 'Escape' }))
  await waitFor(page, menuGone, 3000)
}

// ---------- Step 11: favorites ----------

const favoritesFile = path.join(base, 'userData', 'favorites.json')
const rowHeart = (title) => `[...document.querySelectorAll('.song')].find((item) => item.querySelector('.song-title').textContent === ${JSON.stringify(title)}).parentElement.querySelector('.row-heart')`
const heartPressed = (title) => `${rowHeart(title)}.getAttribute('aria-pressed')`
const clickHeart = (title) => `${rowHeart(title)}.click()`
const playerHeart = `document.querySelector('button[aria-label="Favorite"]')`
const viewTitle = `(document.querySelector('.view-head h1')?.textContent ?? '')`
const emptyText = `(document.querySelector('.empty')?.textContent ?? '')`

function savedFavorites() {
  try {
    return JSON.parse(fs.readFileSync(favoritesFile, 'utf8')).songs
  } catch {
    return null
  }
}

// Waits until the saved file lists exactly these songs (order does not matter).
// A file that is gone is named through its folder, because the app saves paths in the form Windows reports (no short 8.3 names).
function canonical(file) {
  if (fs.existsSync(file)) return fs.realpathSync.native(file).toLowerCase()
  return path.join(fs.realpathSync.native(path.dirname(file)), path.basename(file)).toLowerCase()
}

async function favoritesAre(expected, timeout = 5000) {
  const key = (list) => JSON.stringify(list.map(canonical).sort())
  return until(() => {
    const saved = savedFavorites()
    return saved !== null && key(saved) === key(expected)
  }, timeout)
}

async function checkFavorites(page) {
  const songFile = (...parts) => path.join(music, buffalo, ...parts)
  const hunt = songFile('Tagged', 'with-tags.mp3')
  const tone = songFile('tone-mp3.mp3')
  const damaged = songFile('damaged.mp3')

  await page(clickNav('All songs'))
  await sleep(100)
  for (const title of ['Wild Hunt', 'tone-mp3']) {
    if ((await page(heartPressed(title))) !== 'false') await page(clickHeart(title))
  }
  await sleep(100)
  report(JSON.stringify(await page(sidebar)) === JSON.stringify(['All songs', 'Favorites', 'Recently played', 'Most played', 'Empty Playlist', 'The White Buffalo']), 'the sidebar has a Favorites entry right under All songs', (await page(sidebar)).join(', '))

  await page(clickNav('Favorites'))
  await sleep(100)
  report((await page(viewTitle)) === 'Favorites' && (await page(titles)).length === 0 && (await page(emptyText)).includes('No favorites yet'), 'with no hearts the Favorites list is empty and says how to fill it', await page(emptyText))
  report(await page(`document.querySelector('.s-item.on')?.textContent === 'Favorites'`), 'the Favorites entry is marked as the open list')

  await page(clickNav('All songs'))
  await sleep(100)
  report((await page(heartPressed('Wild Hunt'))) === 'false' && (await page(`${rowHeart('Wild Hunt')}.getAttribute('aria-label')`)) === 'Favorite: Wild Hunt', 'a song starts without a heart')
  const playingBefore = await page(nowTitle)
  await page(clickHeart('Wild Hunt'))
  await page(clickHeart('tone-mp3'))
  await sleep(150)
  report((await page(heartPressed('Wild Hunt'))) === 'true' && (await page(heartPressed('tone-mp3'))) === 'true', 'a click on the heart fills it')
  report((await page(nowTitle)) === playingBefore, 'a click on the heart does not start the song')
  report(await favoritesAre([hunt, tone]), 'the hearts are written to favorites.json in the data folder', JSON.stringify(savedFavorites()))

  await page(clickNav('Favorites'))
  await sleep(150)
  const hearted = await page(titles)
  report(same([...hearted].sort(), ['Wild Hunt', 'tone-mp3']) && (await page(headText)) === '2 songs', 'the Favorites list shows the two hearted songs', hearted.join(', '))

  // The list plays like any other: the song after the first one is the second one.
  if ((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'true') await page(press('Shuffle'))
  for (let i = 0; i < 3 && (await page(`${button('Repeat: off')} === null`)); i++) await page(`document.querySelector('button[aria-label^="Repeat"]').click()`)
  await playAndWait(page, hearted[0])
  await page(press('Next song'))
  await waitFor(page, `${nowTitle} === ${JSON.stringify(hearted[1])}`, 3000)
  report((await page(nowTitle)) === hearted[1], 'the Favorites list plays through like any list', await page(nowTitle))
  await page(press('Playing next'))
  await waitFor(page, `document.querySelector('.queue') !== null`, 3000)
  report((await page(queueRows)).length === 0, 'the queue holds only the Favorites songs (nothing after the last one)', (await page(queueRows)).join(', '))
  await page(press('Playing next'))

  // The heart in the player bar belongs to the playing song and can take it away again.
  report((await page(`${playerHeart}.getAttribute('aria-pressed')`)) === 'true', 'the heart in the player bar is filled for a favorite song')
  await page(`${playerHeart}.click()`)
  await waitFor(page, `${titles}.length === 1`, 3000)
  report(same(await page(titles), [hearted[0]]) && (await page(`${playerHeart}.getAttribute('aria-pressed')`)) === 'false', 'taking the heart away in the player bar removes the song from Favorites', (await page(titles)).join(', '))
  report(await favoritesAre([hearted[0] === 'Wild Hunt' ? hunt : tone]), 'the file follows', JSON.stringify(savedFavorites()))
  report((await page(nowTitle)) === hearted[1], 'the song keeps playing after its heart is taken away')

  // The right-click menu has the heart as its last entry.
  await page(clickNav('All songs'))
  await sleep(100)
  await showMenu(page, 'tone-mp3')
  const first = await page(menuLabels)
  report(first[first.length - 1] === (hearted[1] === 'tone-mp3' ? 'Add to favorites' : 'Remove from favorites'), 'the song menu ends with the heart entry', first.join(', '))
  await page(keyOnFocused({ key: 'Escape' }))
  await waitFor(page, menuGone, 3000)
  await showMenu(page, 'Wild Hunt')
  const wildLabels = await page(menuLabels)
  const wildWas = wildLabels[wildLabels.length - 1]
  await page(clickMenu(wildWas))
  await sleep(150)
  const flipped = (await page(heartPressed('Wild Hunt'))) === (wildWas === 'Add to favorites' ? 'true' : 'false')
  report(flipped, 'the menu entry gives or takes the heart', wildWas)
  // Back to the starting point of the restart test: Wild Hunt and the damaged file have hearts, nothing else.
  for (const [title, wanted] of [['Wild Hunt', 'true'], ['tone-mp3', 'false'], ['damaged', 'true']]) {
    if ((await page(heartPressed(title))) !== wanted) await page(clickHeart(title))
  }
  await sleep(150)
  report(await favoritesAre([hunt, damaged]), 'the hearts to keep across the restart are saved', JSON.stringify(savedFavorites()))

  // The rule the main side keeps: a save sends only text paths, each once.
  report((await page(`new Promise((resolve) => { window.brita.saveFavorites([${JSON.stringify(hunt)}, ${JSON.stringify(hunt)}, '', 7, ${JSON.stringify(damaged)}]); resolve(true) })`)) === true && (await favoritesAre([hunt, damaged])), 'a save with doubles, empty and non-text entries is cleaned before it is written', JSON.stringify(savedFavorites()))

  await page(clickNav('The White Buffalo'))
  await sleep(100)
}

async function checkRememberedFavorites(page) {
  await page(clickNav('Favorites'))
  const settled = await waitFor(page, `${titles}.length === 1`, 8000)
  const list = await page(titles)
  report(settled && same(list, ['Cached Hunt']), 'after a restart the hearts are still there, on the same song under its new title', list.join(', '))
  report((await page(headText)).startsWith('1 song'), 'the Favorites list counts one song: the hearted file that was deleted is not shown', await page(headText))
  report(await favoritesAre([path.join(music, buffalo, 'Tagged', 'with-tags.mp3'), path.join(music, buffalo, 'damaged.mp3')]), 'the heart of a deleted file stays saved (the drive may only be unplugged)', JSON.stringify(savedFavorites()))

  await page(clickNav('All songs'))
  await sleep(100)
  report((await page(heartPressed('Cached Hunt'))) === 'true' && (await page(heartPressed('Brand New'))) === 'false', 'only the hearted song shows a filled heart in the song list')

  await page(clickNav('Favorites'))
  await sleep(100)
  await page(clickHeart('Cached Hunt'))
  await waitFor(page, `${titles}.length === 0`, 3000)
  report((await page(emptyText)).includes('No favorites yet') && (await page(`document.querySelector('.songs-head')`)) === null, 'taking the last visible heart away empties the list')
  report(await favoritesAre([path.join(music, buffalo, 'damaged.mp3')]), 'the file follows', JSON.stringify(savedFavorites()))
  await page(clickNav('All songs'))
  await sleep(100)
}

// ---------- Step 12: recently and most played ----------

const historyFile = path.join(base, 'userData', 'history.json')

function savedPlays() {
  try {
    return JSON.parse(fs.readFileSync(historyFile, 'utf8')).plays
  } catch {
    return null
  }
}

const playOf = (file) => (savedPlays() ?? []).find((play) => canonical(play.path) === canonical(file))
const countOf = (file) => playOf(file)?.count ?? 0
const totalPlays = () => (savedPlays() ?? []).reduce((sum, play) => sum + play.count, 0)
const pauseNow = async (page) => {
  if ((await page(`document.querySelector('.play').getAttribute('aria-label')`)) === 'Pause') await page(`document.querySelector('.play').click()`)
  await sleep(300)
}

// What the two lists must show, worked out from the saved file and the library with a second, independent sort.
async function expectedLists(page) {
  const library = await page(`window.brita.loadLibrary()`)
  const titleOf = new Map(library.songs.map((song) => [song.path, song.title]))
  const plays = (savedPlays() ?? []).filter((play) => titleOf.has(play.path))
  const names = (list) => list.slice(0, 50).map((play) => titleOf.get(play.path))
  return {
    recent: names([...plays].sort((a, b) => b.last - a.last)),
    most: names([...plays].sort((a, b) => b.count - a.count || b.last - a.last)),
  }
}

async function listIs(page, name, expected, timeout = 5000) {
  await page(clickNav(name))
  return waitFor(page, `${viewTitle} === ${JSON.stringify(name)} && JSON.stringify(${titles}) === ${JSON.stringify(JSON.stringify(expected))}`, timeout)
}

async function checkHistory(page) {
  const mp3 = path.join(music, buffalo, 'tone-mp3.mp3')
  const wav = path.join(music, buffalo, 'tone-wav.wav')
  await page(clickNav('All songs'))
  await sleep(100)
  if ((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'true') await page(press('Shuffle'))

  // A song that is skipped after a few seconds does not count. The test songs are 30 seconds long, so half is 15 seconds.
  const total = totalPlays()
  await playAndWait(page, 'tone-mp3')
  await sleep(3000)
  await page(press('Next song'))
  await sleep(300)
  await pauseNow(page)
  await sleep(500)
  report(totalPlays() === total, 'a song skipped after 3 seconds does not count as played', `${total} plays before, ${totalPlays()} after`)

  // A jump forward is not listening: the position passes half, but only about 4 seconds were heard.
  await playAndWait(page, 'tone-wav')
  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  await setSlider(page, '.seek input', 20)
  await sleep(4000)
  await pauseNow(page)
  await sleep(500)
  report(totalPlays() === total && Number(await page(`document.querySelector('.seek input').value`)) > 15, 'jumping past half of a song and listening 4 seconds does not count', `position ${await page(`document.querySelector('.seek input').value`)}`)

  // Listening to half counts once, and not before.
  const before = countOf(mp3)
  const started = Date.now()
  await playAndWait(page, 'tone-mp3')
  const counted = await until(() => countOf(mp3) === before + 1, 25000)
  const seconds = (Date.now() - started) / 1000
  report(counted && seconds >= 13, 'a song counts as played after half of it has been heard', `${seconds.toFixed(1)} s`)
  await sleep(2500)
  report(countOf(mp3) === before + 1, 'the same listening counts only once', `count ${countOf(mp3)}`)
  report((playOf(mp3)?.last ?? 0) >= started, 'the time of the last play is saved too')
  await pauseNow(page)

  // A second song: it becomes the newest, the first one is second.
  await page(clickNav('All songs'))
  await sleep(100)
  await playAndWait(page, 'tone-wav')
  report(await until(() => countOf(wav) >= 1, 25000), 'a second song counts as played too', `count ${countOf(wav)}`)
  await pauseNow(page)

  const wanted = await expectedLists(page)
  report(await listIs(page, 'Recently played', wanted.recent), 'Recently played shows the songs in the order of the last play', (await page(titles)).join(', '))
  report((await page(titles))[0] === 'tone-wav' && (await page(titles))[1] === 'tone-mp3', 'the song played last is on top, the one before it second')
  report((await page(headText)) === `${wanted.recent.length} songs` && (await page(`document.querySelector('.s-item.on')?.textContent`)) === 'Recently played', 'the list is counted and marked as the open list', await page(headText))
  report(await listIs(page, 'Most played', wanted.most), 'Most played shows the songs with the most plays first', (await page(titles)).join(', '))

  // The list plays like any other: the song after the first row is the second row.
  await page(clickNav('Recently played'))
  await sleep(150)
  const rows = await page(titles)
  await page(clickSong(rows[0]))
  await waitFor(page, `${nowTitle} === ${JSON.stringify(rows[0])}`, 3000)
  await page(press('Next song'))
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(rows[1])}`, 3000), 'Recently played plays through like any list', await page(nowTitle))
  await pauseNow(page)
  await page(clickNav('The White Buffalo'))
  await sleep(100)
}

async function checkRememberedHistory(page) {
  const brandNew = path.join(music, buffalo, 'Tagged', 'brand-new.mp3')
  const gone = path.join(music, buffalo, 'damaged.mp3')
  const old = (savedPlays() ?? []).map((play) => play.path)
  report(old.length >= 2 && (playOf(gone)?.count ?? 0) === 99, 'the saved history is still on disk, with the record of the file that was deleted while the app was closed', `${old.length} records`)

  const wanted = await expectedLists(page)
  report(wanted.recent.length >= 2 && await listIs(page, 'Recently played', wanted.recent, 8000), 'after a restart Recently played is the same as before', (await page(titles)).join(', '))
  report(await listIs(page, 'Most played', wanted.most, 8000), 'after a restart Most played is the same as before', (await page(titles)).join(', '))
  report(!(await page(titles)).includes('damaged'), 'the deleted file with 99 plays is not shown')

  // New plays are added to the old history, nothing is lost.
  await page(clickNav('All songs'))
  await sleep(100)
  await playAndWait(page, 'Brand New')
  report(await until(() => countOf(brandNew) === 1, 25000), 'a song played after the restart counts as played', `count ${countOf(brandNew)}`)
  await pauseNow(page)
  const now = savedPlays() ?? []
  report(old.every((file) => now.some((play) => play.path === file)) && (playOf(gone)?.count ?? 0) === 99, 'the old records, also the one of the deleted file, are still in the file', `${now.length} records`)
  const after = await expectedLists(page)
  report(await listIs(page, 'Recently played', after.recent) && (await page(titles))[0] === 'Brand New', 'the new song is on top of Recently played', (await page(titles)).slice(0, 3).join(', '))
  await page(clickNav('All songs'))
  await sleep(100)
}

async function checkVolume(page, window) {
  await playAndWait(page, 'tone-mp3')
  await setSlider(page, '.volume-slider', 0.4)
  await sleep(100)
  let state = await audioState(window)
  report(Math.abs(state.volume - 0.4) < 0.01 && !state.muted, 'the volume slider changes the volume', `volume ${state.volume}`)

  await page(press('Mute'))
  await sleep(100)
  state = await audioState(window)
  const muteLabel = await page(`document.querySelector('.volume .ctl').getAttribute('aria-label')`)
  const shown = await page(`document.querySelector('.volume-slider').value`)
  report(state.muted && muteLabel === 'Unmute' && Number(shown) === 0, 'mute silences the sound and shows it', `${muteLabel}, slider ${shown}`)

  await page(press('Unmute'))
  await sleep(100)
  state = await audioState(window)
  report(!state.muted && Math.abs(state.volume - 0.4) < 0.01, 'unmute brings back the earlier volume', `volume ${state.volume}`)

  await setSlider(page, '.volume-slider', 0)
  await sleep(100)
  report((await page(`document.querySelector('.volume .ctl').getAttribute('aria-label')`)) === 'Unmute', 'volume at zero counts as silent')
  await setSlider(page, '.volume-slider', 0.6)
  await sleep(100)
  state = await audioState(window)
  report(!state.muted && Math.abs(state.volume - 0.6) < 0.01, 'raising the volume again makes sound', `volume ${state.volume}`)
}

// Step 10b: the list of sound outputs next to the volume.
const outButton = `document.querySelector('button[aria-label="Sound output"]')`
const outItems = `[...document.querySelectorAll('.out-item')]`
const outLabels = `${outItems}.map((item) => item.textContent)`
const outChecked = `${outItems}.map((item) => item.getAttribute('aria-checked'))`
const outMenuOpen = `document.querySelector('.out-menu') !== null`
const outMenuGone = `document.querySelector('.out-menu') === null`
const noticeText = `(document.querySelector('.now-notice')?.textContent ?? '')`
// The ids of the real outputs of this PC, without the browser's two virtual entries.
const realOutputs = `navigator.mediaDevices.enumerateDevices().then((list) => list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => d.deviceId))`
const outputFile = path.join(base, 'expected-output.json')

async function waitSink(window, id, timeout = 5000) {
  const end = Date.now() + timeout
  let state = await audioState(window)
  while (state.sink !== id && Date.now() < end) {
    await sleep(100)
    state = await audioState(window)
  }
  return state
}

async function openOutputs(page) {
  await page(`${outButton}.click()`)
  return waitFor(page, outMenuOpen, 3000)
}

async function checkOutput(page, window) {
  await playAndWait(page, 'tone-wav')
  report(await page(`${outButton} !== null && ${outMenuGone}`), 'the player bar has a sound output button, and its list is closed at first')
  report(await openOutputs(page), 'the sound output button opens the list')
  const labels = await page(outLabels)
  const ids = await page(realOutputs)
  report(labels.length === ids.length + 1 && labels[0].startsWith('System default') && labels.every((label) => label !== ''), 'the list starts with "System default" and has one entry per connected output', labels.join(' | '))
  report(same(await page(outChecked), labels.map((_, index) => String(index === 0))), 'at first the system default is the marked entry')
  report((await audioState(window)).sink === '', 'at first the player uses the system default')

  await page(keyOnFocused({ key: 'Escape' }))
  report(await waitFor(page, outMenuGone, 3000) && await page(`document.activeElement === ${outButton}`), 'Escape closes the list and gives the focus back to the button')
  await openOutputs(page)
  await page(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  report(await waitFor(page, outMenuGone, 3000), 'a click outside the list closes it')

  if (ids.length === 0) {
    console.log('SKIP  picking an output (this PC lists no output besides the system default)  UNVERIFIED')
    return
  }
  await openOutputs(page)
  await page(`${outItems}[1].click()`)
  const picked = await waitSink(window, ids[0])
  report(picked.sink === ids[0] && !picked.paused, 'picking an output sends the playing song to it without stopping it', `wanted ${ids[0].slice(0, 10)}, player ${picked.sink.slice(0, 10)}, paused ${picked.paused}`)
  report(await waitFor(page, outMenuGone, 3000), 'picking an output closes the list')
  report((await page(`${outButton}.title`)) === `Sound output: ${labels[1]}`, 'the button names the output in use', await page(`${outButton}.title`))
  await openOutputs(page)
  report(same(await page(outChecked), labels.map((_, index) => String(index === 1))), 'the list marks the chosen output')
  report(await waitForSavedSettings({ outputDevice: ids[0] }), 'the chosen output is saved')

  await page(`${outItems}[0].click()`)
  const back = await waitSink(window, '')
  report(back.sink === '' && (await waitForSavedSettings({ outputDevice: '' })), 'picking "System default" goes back and saves it', `player ${back.sink.slice(0, 10)}`)
}

// Leaves a chosen output behind for the restart.
async function chooseOutputForRestart(page, window) {
  const ids = await page(realOutputs)
  if (ids.length === 0) return
  await openOutputs(page)
  await page(`${outItems}[1].click()`)
  await waitSink(window, ids[0])
  const saved = await waitForSavedSettings({ outputDevice: ids[0] })
  fs.writeFileSync(outputFile, JSON.stringify({ id: ids[0] }))
  report(saved, 'an output is chosen and saved for the restart')
}

async function checkRememberedOutput(page, window) {
  if (!fs.existsSync(outputFile)) return
  const { id } = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
  const state = await waitSink(window, id, 8000)
  report(state.sink === id, 'after a restart the sound still goes to the chosen output', `wanted ${id.slice(0, 10)}, player ${state.sink.slice(0, 10)}`)
  await openOutputs(page)
  report((await page(outChecked)).filter((value) => value === 'true').length === 1 && (await page(outChecked))[0] === 'false', 'after a restart the list marks the chosen output, not the system default')
  await page(keyOnFocused({ key: 'Escape' }))
  await waitFor(page, outMenuGone, 3000)
}

// The output list is replaced inside the page, as if a headset were unplugged and another one plugged in.
async function checkOutputChanges(page, window) {
  if (!fs.existsSync(outputFile)) return
  const { id } = JSON.parse(fs.readFileSync(outputFile, 'utf8'))
  const fakeList = (extra) => `(() => {
    const real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
    window.__realEnumerate = window.__realEnumerate ?? real
    navigator.mediaDevices.enumerateDevices = async () => {
      const list = await window.__realEnumerate()
      const kept = list.filter((d) => d.deviceId !== ${JSON.stringify(id)})
      return kept.concat(${JSON.stringify(extra)})
    }
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })()`
  report((await audioState(window)).paused === false, 'a song is playing while the output disappears')
  await page(fakeList([]))
  const gone = await waitFor(page, `${noticeText}.includes('no longer connected')`, 5000)
  const state = await waitSink(window, '')
  report(gone && state.sink === '' && !state.paused, 'an unplugged output returns the sound to the system default with a short message, and the song keeps playing', await page(noticeText))
  report(await waitForSavedSettings({ outputDevice: '' }), 'the fallback to the system default is saved')

  await page(fakeList([{ kind: 'audiooutput', deviceId: 'test-headset', label: 'Test headset' }]))
  await sleep(300)
  await openOutputs(page)
  report(await waitFor(page, `${outItems}.some((item) => item.textContent === 'Test headset')`, 5000), 'a newly plugged-in output appears in the list by itself')
  await page(`${outItems}.find((item) => item.textContent === 'Test headset').click()`)
  const refused = await waitFor(page, `${noticeText}.includes('could not be used')`, 5000)
  const after = await waitSink(window, '')
  report(refused && after.sink === '' && !after.paused, 'an output Windows refuses gives a short message and the system default', await page(noticeText))
}

// Step 14: the sleep timer. Time is moved forward inside the page (Date.now), so a 30 minute timer needs no 30 minute wait.
const sleepButton = `document.querySelector('button[aria-label="Sleep timer"]')`
const sleepItems = `[...document.querySelectorAll('.sleep-item')]`
const sleepMenuGone = `document.querySelector('.sleep-menu') === null`
const sleepText = `(${sleepButton}.querySelector('.sleep-left')?.textContent ?? '')`
const sleepTitleNow = `${sleepButton}.title`
const shiftClock = (minutes) => `(() => { window.__realNow = window.__realNow ?? Date.now; Date.now = () => window.__realNow() + ${minutes} * 60000 })()`
const restoreClock = `(() => { if (window.__realNow) { Date.now = window.__realNow; delete window.__realNow } })()`

async function openSleep(page) {
  await page(`${sleepButton}.click()`)
  return waitFor(page, `document.querySelector('.sleep-menu') !== null`, 3000)
}

async function chooseSleep(page, label) {
  await openSleep(page)
  await page(`${sleepItems}.find((item) => item.textContent === ${JSON.stringify(label)}).click()`)
  await waitFor(page, sleepMenuGone, 3000)
}

// Follows the volume of the audio element until playback stops; returns the lowest volume seen.
async function watchFade(window, timeout = 8000) {
  let lowest = 1
  let state = await audioState(window)
  const end = Date.now() + timeout
  while (!state.paused && Date.now() < end) {
    lowest = Math.min(lowest, state.volume)
    await sleep(60)
    state = await audioState(window)
  }
  return { lowest, state }
}

async function waitVolume(window, wanted, timeout = 3000) {
  const end = Date.now() + timeout
  let state = await audioState(window)
  while (Math.abs(state.volume - wanted) > 0.01 && Date.now() < end) {
    await sleep(60)
    state = await audioState(window)
  }
  return state
}

async function checkSleepLayout(page, window) {
  const start = window.getBounds()
  window.setSize(800, start.height)
  await sleep(400)
  const found = await page(`(() => {
    const player = document.querySelector('.player').getBoundingClientRect()
    const transport = document.querySelector('.transport').getBoundingClientRect()
    const volume = document.querySelector('.volume')
    const boxes = [...volume.children].map((item) => item.getBoundingClientRect())
    const problems = []
    boxes.forEach((box, index) => {
      if (box.right > player.right + 0.5) problems.push('item ' + index + ' leaves the player bar')
      if (index > 0 && box.left < boxes[index - 1].right - 0.5) problems.push('item ' + index + ' overlaps the one before')
    })
    if (boxes[0].left < transport.right - 0.5) problems.push('the volume group overlaps the transport')
    return { width: window.innerWidth, problems, slider: document.querySelector('.volume-slider').getBoundingClientRect().width }
  })()`)
  window.setBounds(start)
  await sleep(300)
  report(found.problems.length === 0 && found.slider >= 40, 'at the smallest window width the volume buttons and the running timer fit without overlap', `window ${found.width} px wide, slider ${Math.round(found.slider)} px, ${found.problems.join('; ') || 'no problems'}`)
}

async function checkSleepTimer(page, window) {
  await playAndWait(page, 'tone-wav')
  const before = (await audioState(window)).volume
  report(await page(`${sleepButton} !== null && ${sleepMenuGone} && ${sleepTitleNow} === 'Sleep timer' && ${sleepText} === ''`), 'the player bar has a sleep timer button; at first no timer runs and its list is closed')

  report(await openSleep(page), 'the sleep timer button opens the list')
  const names = await page(`${sleepItems}.map((item) => item.textContent)`)
  report(same(names, ['Stop after 15 minutes', 'Stop after 30 minutes', 'Stop after 60 minutes', 'Stop after this song']), 'the list offers 15, 30 and 60 minutes and the end of the song, and no "turn off" while no timer runs', names.join(' | '))
  await page(keyOnFocused({ key: 'Escape' }))
  report(await waitFor(page, sleepMenuGone, 3000) && await page(`document.activeElement === ${sleepButton}`), 'Escape closes the list and gives the focus back to the button')
  await openSleep(page)
  await page(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  report(await waitFor(page, sleepMenuGone, 3000), 'a click outside the list closes it')

  await chooseSleep(page, 'Stop after 15 minutes')
  const first = await page(sleepText)
  report(/^(15:00|14:5\d)$/.test(first) && (await page(sleepTitleNow)).startsWith('Sleep timer: stops in ') && (await audioState(window)).paused === false, 'picking 15 minutes shows the time left in the player bar and the song keeps playing', `${first}, ${await page(sleepTitleNow)}`)
  await sleep(2300)
  const later = await page(sleepText)
  report(seconds(later) <= 14 * 60 + 58 && seconds(later) >= 14 * 60 + 40, 'the time left counts down', `${first} then ${later}`)

  await openSleep(page)
  const withCancel = await page(`${sleepItems}.map((item) => item.textContent)`)
  report(withCancel[withCancel.length - 1] === 'Turn off the timer', 'while a timer runs the list ends with "Turn off the timer"', withCancel.join(' | '))
  await page(`${sleepItems}.find((item) => item.textContent === 'Turn off the timer').click()`)
  report(await waitFor(page, `${sleepText} === '' && ${sleepTitleNow} === 'Sleep timer' && !${sleepButton}.classList.contains('on')`, 3000), 'turning the timer off removes the countdown')

  await chooseSleep(page, 'Stop after 60 minutes')
  await checkSleepLayout(page, window)
  await openSleep(page)
  await page(`${sleepItems}.find((item) => item.textContent === 'Turn off the timer').click()`)
  await waitFor(page, `${sleepText} === ''`, 3000)

  // Time is up while music plays: the sound fades out, then the song stops.
  await chooseSleep(page, 'Stop after 30 minutes')
  await page(shiftClock(31))
  const fade = await watchFade(window)
  report(fade.state.paused && fade.lowest < before * 0.6, 'when the time is up the sound fades out and the song stops', `volume before ${before}, lowest seen ${fade.lowest.toFixed(2)}, paused ${fade.state.paused}`)
  const back = await waitVolume(window, before)
  report(Math.abs(back.volume - before) < 0.01 && back.paused, 'after the fade the volume is back where it was, so the next song is not quiet', `volume ${back.volume}`)
  report(await waitFor(page, `${noticeText} === 'Sleep timer: playback stopped.' && ${sleepText} === '' && document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'a short message says the timer stopped the music, the countdown is gone and the button offers Play', await page(noticeText))
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  report(Math.abs(saved.volume - before) < 0.01, 'the fade does not change the saved volume', `saved ${saved.volume}`)
  await page(restoreClock)
  await page(press('Play'))
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000) && Math.abs((await audioState(window)).volume - before) < 0.01 && (await page(sleepText)) === '', 'pressing Play afterwards plays at the earlier volume and the timer does not come back')

  // Pausing during the fade brings the volume back at once.
  await chooseSleep(page, 'Stop after 15 minutes')
  await page(shiftClock(16))
  await sleep(700)
  const during = (await audioState(window)).volume
  await page(press('Pause'))
  const calm = await waitVolume(window, before)
  await page(restoreClock)
  report(during < before - 0.05 && Math.abs(calm.volume - before) < 0.01 && calm.paused, 'pausing in the middle of a fade puts the volume back', `during ${during.toFixed(2)}, after ${calm.volume}`)

  // The time runs out while nothing plays: the timer just ends, with no message.
  await waitFor(page, `${noticeText} === ''`, 10000)
  await chooseSleep(page, 'Stop after 15 minutes')
  await page(shiftClock(16))
  const gone = await waitFor(page, `${sleepText} === ''`, 3000)
  await page(restoreClock)
  report(gone && (await audioState(window)).paused && (await page(noticeText)) === '', 'a timer that ends while paused just switches off, with no message', await page(noticeText))
}

// "After this song": the timer waits for the song to end, then the next song is ready but does not start.
async function checkSleepAfterSong(page, window) {
  await playAndWait(page, 'tone-wav')
  const [following] = await nextTitles(page, 1)
  await playAndWait(page, 'tone-wav')
  await chooseSleep(page, 'Stop after this song')
  report(await page(`${sleepText} === 'Song end' && ${sleepTitleNow} === 'Sleep timer: stops after this song'`), 'picking "Stop after this song" shows "Song end" in the player bar')
  await seekNearEnd(page)
  const stopped = await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play' && ${noticeText}.includes('stopped after the song')`, 10000)
  const state = await audioState(window)
  report(stopped && state.paused && (await page(sleepText)) === '', 'at the end of the song the music stops and the timer switches off', await page(noticeText))
  report((await page(nowTitle)) === following, 'the next song is loaded and waits', `${await page(nowTitle)}, expected ${following}`)
  if (following !== 'damaged' && following !== 'old-format') {
    await page(press('Play'))
    report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause' && ${nowTitle} === ${JSON.stringify(following)}`, 5000), 'pressing Play starts the waiting song')
  }

  // Skipping does not disarm it; it then ends the song that plays by then.
  await playAndWait(page, 'tone-wav')
  await chooseSleep(page, 'Stop after this song')
  await page(press('Next song'))
  await sleep(300)
  report((await page(sleepText)) === 'Song end', 'skipping to another song keeps "Song end" armed')
  await openSleep(page)
  await page(`${sleepItems}.find((item) => item.textContent === 'Turn off the timer').click()`)
  report(await waitFor(page, `${sleepText} === ''`, 3000), 'the song timer can be turned off')

  // Repeat one: the same song stays, and the music stops.
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // off -> all
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // all -> one
  await playAndWait(page, 'tone-wav')
  await chooseSleep(page, 'Stop after this song')
  await seekNearEnd(page)
  const stoppedOne = await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play' && ${noticeText}.includes('stopped after the song')`, 10000)
  report(stoppedOne && (await page(nowTitle)) === 'tone-wav' && (await audioState(window)).paused, 'with "repeat one" the music still stops at the end of the song and stays on that song')
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // one -> off
}

// Leaves a running timer behind: a restart must not bring it back.
async function leaveSleepForRestart(page) {
  await chooseSleep(page, 'Stop after 60 minutes')
  report(await page(`${sleepText} !== ''`), 'a 60 minute timer is left running for the restart')
}

async function checkSleepGone(page) {
  report(await page(`${sleepText} === '' && ${sleepTitleNow} === 'Sleep timer'`), 'after a restart no sleep timer runs')
}

async function checkSpaceBar(page, window) {
  window.webContents.focus()
  await playAndWait(page, 'tone-mp3')
  await sleep(1500)
  const before = (await audioState(window)).time
  const key = (type) => window.webContents.sendInputEvent({ type, keyCode: 'Space' })
  key('keyDown'); key('keyUp')
  await sleep(500)
  let state = await audioState(window)
  report(state.paused && state.time >= before, 'the space bar pauses (and does not restart the song)', `${before.toFixed(1)} s then ${state.time.toFixed(1)} s`)
  key('keyDown'); key('keyUp')
  await sleep(1000)
  state = await audioState(window)
  report(!state.paused && state.time >= before, 'the space bar plays again from the same place', `${state.time.toFixed(1)} s`)
}

async function checkMediaKeys(page, window) {
  // Step 7: the keys belong to the page's media session, so the app must not register them itself.
  const wanted = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop']
  const taken = wanted.filter((key) => globalShortcut.isRegistered(key))
  report(taken.length === 0, 'the app does not register the media keys itself (the media session handles them)', taken.length ? `registered: ${taken.join(', ')}` : '')

  const session = `(() => { const s = navigator.mediaSession; const m = s.metadata; return m ? { title: m.title, artist: m.artist, album: m.album, art: m.artwork[0]?.src ?? '', state: s.playbackState } : { state: s.playbackState } })()`
  await playAndWait(page, 'Wild Hunt')
  await sleep(200)
  let info = await page(session)
  report(info.title === 'Wild Hunt' && info.artist === 'Björk' && info.album === 'Debut' && info.art.startsWith('brita-media://cover/') && info.state === 'playing', 'the media session gets title, artist, album, cover address and "playing"', JSON.stringify(info))
  await page(press('Pause'))
  await sleep(200)
  report((await page(session)).state === 'paused', 'the media session says "paused" when the song is paused')

  await playAndWait(page, 'tone-mp3')
  window.webContents.send('media:key', 'play-pause')
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'media key play/pause pauses')
  window.webContents.send('media:key', 'play-pause')
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000), 'media key play/pause plays')
  const list = await page(titles)
  window.webContents.send('media:key', 'next')
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(list[list.indexOf('tone-mp3') + 1])}`, 3000), 'media key next plays the next song')
  window.webContents.send('media:key', 'previous')
  report(await waitFor(page, `${nowTitle} === 'tone-mp3'`, 3000), 'media key previous goes back')
  window.webContents.send('media:key', 'stop')
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'media key stop pauses')
}

// ---------- Step 5: search, sort, playlist header, highlight ----------

const headText = `(document.querySelector('.view-head .head-text p')?.textContent ?? '')`
const search = (page, value) => page(setNative('#song-search', 'HTMLInputElement', value))
const clickHead = (name) => `[...document.querySelectorAll('.head-btn')].find((item) => item.textContent === ${JSON.stringify(name)}).click()`
const activeHead = `(document.querySelector('.head-btn.on')?.getAttribute('aria-label') ?? '')`
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function resetSort(page) {
  for (let i = 0; i < 3 && (await page(activeHead)) !== ''; i++) {
    await page(`document.querySelector('.head-btn.on').click()`)
    await sleep(60)
  }
}

async function checkPlaylistHeader(page) {
  await page(clickNav('The White Buffalo'))
  await sleep(150)
  const songs = await page(titles)
  const text = await page(headText)
  report(text.startsWith(`${songs.length} songs`), 'the playlist header shows the song count', text)
  report(await waitFor(page, `(() => { const img = document.querySelector('.head-cover img'); return img !== null && img.complete && img.naturalWidth > 0 })()`, 8000), 'the playlist header shows the cover of its songs')
  report((await page(`document.querySelector('.view-head h1').textContent`)) === 'The White Buffalo', 'the playlist header shows the playlist name')

  await page(clickNav('All songs'))
  await sleep(150)
  const all = await page(titles)
  report((await page(headText)).startsWith(`${all.length} songs`) && (await page(`document.querySelector('.head-cover img')`)) === null, 'All songs shows its count and an icon, not a cover')

  await page(clickNav('Empty Playlist'))
  await sleep(150)
  report((await page(headText)).startsWith('0 songs') && (await page(`document.querySelector('#song-search')`)) === null, 'an empty playlist shows 0 songs and no search box')
  await page(clickNav('The White Buffalo'))
  await sleep(100)
}

async function checkSearch(page, window) {
  await page(clickNav('The White Buffalo'))
  await sleep(150)
  const full = await page(titles)

  const place = await page(`(() => {
    const label = document.querySelector('label[for=song-search]')
    const input = document.querySelector('#song-search')
    return label && input ? { text: label.textContent, above: label.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1 } : null
  })()`)
  report(place !== null && place.text === 'Search songs' && place.above, 'the search box has its label above it', JSON.stringify(place))

  await search(page, 'bjork')
  await sleep(150)
  report(same(await page(titles), ['Wild Hunt']), 'search finds a song by artist, ignoring accents and case', (await page(titles)).join(', '))
  report((await page(headText)).startsWith(`1 of ${full.length} songs`), 'while searching the header shows how many songs match', await page(headText))
  await search(page, 'DEBUT')
  await sleep(150)
  report(same(await page(titles), ['Wild Hunt']), 'search finds a song by album')
  await search(page, 'wild')
  await sleep(150)
  report(same(await page(titles), ['Wild Hunt']), 'search finds a song by title')
  await search(page, 'sigur ros')
  await sleep(150)
  report(same(await page(titles), ['Flac Song']), 'a search with two words needs both')
  await search(page, 'hunt flac')
  await sleep(150)
  report((await page(`document.querySelectorAll('.song').length`)) === 0, 'two words that belong to different songs match nothing')

  await search(page, 'zzzzz')
  await sleep(150)
  const none = await page(`document.querySelector('.empty')?.textContent ?? ''`)
  report(none.includes('No song matches') && none.includes('zzzzz') && (await page(`document.querySelectorAll('.song').length`)) === 0, 'no match gives a clear message', none)
  await page(`document.querySelector('.empty .link-btn').click()`)
  await sleep(150)
  report(same(await page(titles), full) && (await page(`document.querySelector('#song-search').value`)) === '', 'the Clear search link in that message brings the whole list back')

  await search(page, 'bjork')
  await sleep(100)
  await page(`document.querySelector('button[aria-label="Clear search"]').click()`)
  await sleep(150)
  report(same(await page(titles), full), 'the clear button in the search box brings the whole list back')

  await search(page, 'bjork')
  await sleep(100)
  await page(`document.querySelector('#song-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(150)
  report(same(await page(titles), full) && (await page(`document.querySelector('#song-search').value`)) === '', 'Escape clears the search')

  window.webContents.focus()
  await page(`document.activeElement.blur()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] })
  report(await waitFor(page, `document.activeElement?.id === 'song-search'`, 3000), 'Ctrl+F jumps to the search box')

  // Typing a space in the search box must not pause the music.
  await playAndWait(page, 'tone-mp3')
  await page(`document.querySelector('#song-search').focus()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await sleep(400)
  report((await page(`document.querySelector('.play').getAttribute('aria-label')`)) === 'Pause', 'a space typed in the search box does not pause the music')

  await search(page, 'bjork')
  await sleep(100)
  await page(clickNav('All songs'))
  await sleep(150)
  report((await page(`document.querySelector('#song-search').value`)) === '', 'opening another list clears the search')
  await page(clickNav('The White Buffalo'))
  await sleep(100)
}

async function checkSort(page) {
  const full = await page(titles)
  await page(clickHead('Title'))
  await sleep(150)
  report(same(await page(titles), [...full].sort(collator.compare)) && (await page(activeHead)) === 'Sort by Title, A to Z', 'a click on Title sorts A to Z', await page(activeHead))
  await page(clickHead('Title'))
  await sleep(150)
  report(same(await page(titles), [...full].sort(collator.compare).reverse()) && (await page(activeHead)) === 'Sort by Title, Z to A', 'a second click sorts Z to A', await page(activeHead))
  await page(clickHead('Title'))
  await sleep(150)
  report(same(await page(titles), full) && (await page(activeHead)) === '', 'a third click goes back to the folder order')

  await page(clickHead('Artist'))
  await sleep(150)
  let list = await page(titles)
  report(same(list.slice(0, 3), ['Wild Hunt', 'Flac Song', 'Opus Song']), 'Artist sorts A to Z, songs without an artist come last', list.slice(0, 4).join(', '))
  await page(clickHead('Artist'))
  await sleep(150)
  list = await page(titles)
  report(same(list.slice(0, 3), ['Opus Song', 'Flac Song', 'Wild Hunt']) && same(list.slice(3), full.filter((title) => !['Wild Hunt', 'Flac Song', 'Opus Song'].includes(title))), 'Artist Z to A keeps songs without an artist last, in folder order')

  await page(clickHead('Length'))
  await sleep(150)
  list = await page(titles)
  report(list.slice(-2).sort().join() === 'damaged,old-format', 'Length puts songs with no known length last', list.slice(-3).join(', '))
  await page(clickHead('Length'))
  await sleep(150)
  report((await page(titles)).slice(-2).sort().join() === 'damaged,old-format', 'Length Z to A also puts them last')
  const columns = await page(`[...document.querySelectorAll('.head-btn')].map((item) => item.textContent)`)
  report(same(columns, ['Title', 'Artist', 'Album', 'Length']), 'the column titles are Title, Artist, Album and Length', columns.join(', '))
  await resetSort(page)

  // Playing from a sorted, searched list goes on in the order shown.
  await search(page, 'tone')
  await page(clickHead('Title'))
  await page(clickHead('Title'))
  await sleep(200)
  list = await page(titles)
  report(list.length >= 4 && same(list, [...list].sort(collator.compare).reverse()), 'a search and a sort work together', list.join(', '))
  await playAndWait(page, list[0])
  await page(press('Next song'))
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(list[1])}`, 4000), 'next continues in the order shown on the screen', `${list[0]} then ${list[1]}`)
  await search(page, '')
  await resetSort(page)
  await sleep(100)
}

async function checkPlayingRow(page) {
  await playAndWait(page, 'tone-mp3')
  await sleep(200)
  const row = (selector) => page(`(() => { const rows = [...document.querySelectorAll('.song.on')]; return ${selector} })()`)
  report((await row('rows.length')) === 1 && (await row('rows[0].querySelector(".song-title").textContent')) === 'tone-mp3', 'the playing song is highlighted, and only that one')
  report((await row('rows[0].querySelector(".song-no svg[aria-label=Playing]") !== null')) === true, 'the highlighted song shows a speaker instead of its number')
  await page(press('Pause'))
  await sleep(200)
  report((await row('rows.length === 1 && rows[0].querySelector(".song-no svg") === null && /^\\d+$/.test(rows[0].querySelector(".song-no").textContent)')) === true, 'a paused song stays highlighted and shows its number again')
}

const folderNames = `[...document.querySelectorAll('.folder-name')].map((name) => name.textContent)`
const sidebar = `[...document.querySelectorAll('.s-item')].map((item) => item.textContent)`

// Step 8: the music folders live on the settings page, opened with the gear button in the sidebar.
const onSettings = `document.querySelector('.settings') !== null`
const gear = `[...document.querySelectorAll('.s-link')].find((item) => item.textContent === 'Settings')`
const addFolderClick = `[...document.querySelectorAll('.settings .btn')].find((item) => item.textContent.includes('Add folder')).click()`

async function openSettings(page) {
  if (!(await page(onSettings))) await page(`${gear}.click()`)
  await waitFor(page, onSettings, 3000)
}

async function closeSettings(page) {
  if (await page(onSettings)) await page(`${gear}.click()`)
  await waitFor(page, `!(${onSettings})`, 3000)
}

function makeSecondFolder() {
  fs.mkdirSync(path.join(second, 'Second Playlist'), { recursive: true })
  fs.writeFileSync(path.join(second, 'Second Playlist', 's1.wav'), makeWav())
  fs.writeFileSync(path.join(second, 'loose2.wav'), makeWav())
}

async function checkRemoveFolder(page, window) {
  makeSecondFolder()
  chosen = second
  await openSettings(page)
  await page(addFolderClick)
  report(await waitFor(page, `${sidebar}.includes('Second Playlist')`), 'a second music folder can be added next to the first, from the settings page')
  report(JSON.stringify(await page(folderNames)) === JSON.stringify(['Musik', 'Second']), 'the settings page lists both music folders', (await page(folderNames)).join(', '))

  await page(clickNav('Second Playlist'))
  await sleep(100)
  report(!(await page(onSettings)), 'picking a playlist leaves the settings page')
  await playAndWait(page, 's1')

  await openSettings(page)
  await page(press('Remove folder Second'))
  const asked = await page(`document.querySelector('.folder-ask')?.textContent ?? ''`)
  report(asked.includes('Your files stay'), 'removing asks first and says the files stay', asked)
  await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Keep').click()`)
  await sleep(300)
  report((await page(sidebar)).includes('Second Playlist') && (await page(folderNames)).length === 2, '"Keep" leaves the folder as it was')

  const started = Date.now()
  await page(press('Remove folder Second'))
  await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Remove').click()`)
  const gone = await waitFor(page, `!${sidebar}.includes('Second Playlist') && ${folderNames}.length === 1`, 8000)
  report(gone, 'the removed folder and its playlist disappear', `${Date.now() - started} ms`)
  await closeSettings(page)
  report((await page(`document.querySelector('.view-head h1').textContent`)) === 'All songs', 'a view of a removed playlist falls back to All songs')
  const all = await page(titles)
  report(!all.includes('s1') && !all.includes('loose2'), 'the songs of the removed folder disappear')
  const state = await audioState(window)
  report((await page(nowTitle)) === '' && state.paused && state.src === '', 'the song that was playing from the removed folder stops')
  report(fs.existsSync(path.join(second, 'Second Playlist', 's1.wav')) && fs.existsSync(path.join(second, 'loose2.wav')), 'the files of the removed folder are still on the disk')
  const refused = await net.fetch(`brita-media://song/${encodeURIComponent(path.join(second, 'loose2.wav'))}`)
  report(refused.status === 403, 'a song of a removed folder is no longer served', `status ${refused.status}`)
  chosen = music
}

// ---------- Step 4: live folders and new playlists ----------

const LIVE_WAIT = 12000
const setNative = (selector, prototype, value) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)})
  const setter = Object.getOwnPropertyDescriptor(${prototype}.prototype, 'value').set
  setter.call(element, ${JSON.stringify(value)})
  element.dispatchEvent(new Event(${JSON.stringify(prototype === 'HTMLSelectElement' ? 'change' : 'input')}, { bubbles: true }))
})()`
const typeName = (page, value) => page(setNative('#new-playlist-name', 'HTMLInputElement', value))
const submitForm = (page) => page(`document.querySelector('.new-playlist button[type=submit]').click()`)
const formError = `(document.querySelector('.field-error')?.textContent ?? '')`
const warning = `(document.querySelector('.message.warn')?.textContent ?? '')`

// Counts what the app sends to its window, to see whether a look at the folders redrew the list.
function countLibraryMessages(window) {
  const counter = { count: 0 }
  const original = window.webContents.send.bind(window.webContents)
  window.webContents.send = (channel, ...args) => {
    if (channel === 'library:updated') counter.count++
    return original(channel, ...args)
  }
  return counter
}

async function timed(page, expression, timeout = LIVE_WAIT) {
  const started = Date.now()
  const ok = await waitFor(page, expression, timeout)
  return { ok, ms: Date.now() - started }
}

async function checkLiveFolders(page, window) {
  const messages = countLibraryMessages(window)
  await page(clickNav('All songs'))
  await sleep(200)

  // A new playlist folder with a song, made outside the app (as in Windows Explorer).
  const band = path.join(music, 'Live Band')
  fs.mkdirSync(band)
  fs.writeFileSync(path.join(band, 'live-song.wav'), makeWav())
  let seen = await timed(page, `${sidebar}.includes('Live Band') && ${titles}.includes('live-song')`)
  report(seen.ok, 'a folder with a song made outside the app appears as a playlist, without a restart', `${seen.ms} ms`)

  // A song added to a playlist that already exists.
  fs.writeFileSync(path.join(music, buffalo, 'added-later.wav'), makeWav())
  seen = await timed(page, `${titles}.includes('added-later')`)
  report(seen.ok, 'a song copied into an existing playlist appears', `${seen.ms} ms`)

  // A song deleted outside the app.
  fs.rmSync(path.join(music, buffalo, 'added-later.wav'))
  seen = await timed(page, `!${titles}.includes('added-later')`)
  report(seen.ok, 'a song deleted outside the app disappears', `${seen.ms} ms`)

  // A playlist folder renamed outside the app, while the person looks at it.
  await page(clickNav('Live Band'))
  await sleep(200)
  fs.renameSync(band, path.join(music, 'Live Band 2'))
  seen = await timed(page, `${sidebar}.includes('Live Band 2') && !${sidebar}.includes('Live Band')`)
  report(seen.ok, 'a renamed folder shows its new name and not the old one', `${seen.ms} ms`)
  report((await page(`document.querySelector('.view-head h1').textContent`)) === 'All songs', 'a playlist that was renamed while open falls back to All songs')

  // A playlist folder removed outside the app.
  fs.rmSync(path.join(music, 'Live Band 2'), { recursive: true })
  seen = await timed(page, `!${sidebar}.includes('Live Band 2') && !${titles}.includes('live-song')`)
  report(seen.ok, 'a folder deleted outside the app disappears with its songs', `${seen.ms} ms`)

  // A look at the folders that finds nothing new must not redraw the list; a real change must.
  const before = messages.count
  fs.writeFileSync(path.join(music, 'notes.txt'), 'changed text, still not music')
  await sleep(3500)
  report(messages.count === before, 'a change to a file that is not music does not redraw the list', `${messages.count - before} redraws`)
  fs.writeFileSync(path.join(music, 'redraw-proof.wav'), makeWav())
  seen = await timed(page, `${titles}.includes('redraw-proof')`)
  report(seen.ok && messages.count > before, 'a real change does redraw it', `${messages.count - before} redraws`)
  fs.rmSync(path.join(music, 'redraw-proof.wav'))
  await waitFor(page, `!${titles}.includes('redraw-proof')`, LIVE_WAIT)
}

async function checkMissingFolder(page) {
  makeSecondFolder()
  chosen = second
  await openSettings(page)
  await page(addFolderClick)
  await waitFor(page, `${sidebar}.includes('Second Playlist')`)
  await closeSettings(page)

  const away = `${second}-away`
  fs.renameSync(second, away)
  let seen = await timed(page, `${warning}.includes('cannot be found') && ${warning}.includes('Second')`)
  report(seen.ok, 'a music folder that vanishes (like an unplugged drive) gives a clear message', `${seen.ms} ms: ${await page(warning)}`)
  await openSettings(page)
  const badge = await page(`document.querySelector('.folder .badge.warn')?.textContent ?? ''`)
  report(badge === 'Not found' && (await page(folderNames)).includes('Second'), 'the folder stays in the list, marked "Not found"', badge)
  await closeSettings(page)
  report(!(await page(sidebar)).includes('Second Playlist') && !(await page(titles)).includes('s1'), 'its playlists and songs are not shown while it is gone')
  report((await page(sidebar)).includes('The White Buffalo') && (await page(titles)).includes('nested'), 'the other music folder keeps working')

  fs.renameSync(away, second)
  seen = await timed(page, `${sidebar}.includes('Second Playlist') && ${warning} === ''`)
  report(seen.ok, 'the folder is picked up by itself when it is back, and the message goes away', `${seen.ms} ms`)
  report((await page(titles)).includes('s1'), 'its songs are back')
}

async function checkNewPlaylist(page) {
  const wait = (expression) => waitFor(page, expression, 6000)
  const before = fs.readdirSync(music).length

  await page(`document.querySelector('.s-action').click()`)
  report(await wait(`document.querySelector('#new-playlist-name') !== null`), '"New playlist" opens a form')
  const order = await page(`(() => {
    const label = document.querySelector('label[for=new-playlist-name]').getBoundingClientRect()
    const input = document.querySelector('#new-playlist-name').getBoundingClientRect()
    return { text: label.height > 0 ? document.querySelector('label[for=new-playlist-name]').textContent : '', above: label.bottom <= input.top + 1 }
  })()`)
  report(order.text === 'Playlist name' && order.above, 'the name field has its label above it', JSON.stringify(order))

  // With two music folders the form asks where to create it.
  const select = await page(`document.querySelector('#new-playlist-folder') !== null && document.querySelector('label[for=new-playlist-folder]').textContent`)
  report(select === 'Music folder', 'with two music folders the form asks which one', String(select))
  const choices = await page(`[...document.querySelectorAll('#new-playlist-folder option')].map((option) => option.textContent)`)
  report(JSON.stringify(choices) === JSON.stringify(['Musik', 'Second']), 'the choices are the music folders', choices.join(', '))

  await typeName(page, '')
  await submitForm(page)
  report(await wait(`${formError}.includes('Type a name')`), 'an empty name gives a clear message', await page(formError))
  await typeName(page, 'a/b')
  await submitForm(page)
  report(await wait(`${formError}.includes('cannot contain')`), 'a name with a forbidden character gives a clear message', await page(formError))
  await typeName(page, 'Con')
  await submitForm(page)
  report(await wait(`${formError}.includes('Windows does not allow')`), 'a name Windows reserves gives a clear message', await page(formError))
  await typeName(page, 'The white buffalo')
  await submitForm(page)
  report(await wait(`${formError}.includes('already exists')`), 'a name that already exists gives a clear message', await page(formError))
  report(fs.readdirSync(music).length === before && !fs.existsSync(path.join(music, 'a')), 'no folder was made by the refused names')
  report((await page(`document.querySelector('#new-playlist-name') !== null`)), 'the form stays open so the name can be fixed')
  await typeName(page, 'x')
  report(await wait(`${formError} === ''`), 'the message goes away when the person types again')

  await typeName(page, 'Road trip')
  await submitForm(page)
  const made = path.join(music, 'Road trip')
  report(await wait(`${sidebar}.includes('Road trip') && document.querySelector('.view-head h1').textContent === 'Road trip'`), 'creating shows the new playlist and opens it')
  report(fs.existsSync(made) && fs.statSync(made).isDirectory() && fs.readdirSync(made).length === 0, 'it is a real, empty folder inside the music folder')
  report((await page(`document.querySelector('.empty')?.textContent ?? ''`)).includes('No music files'), 'the new playlist says it is empty')
  report((await page(`document.querySelector('#new-playlist-name')`)) === null, 'the form closes after creating')

  // In the second music folder, picked in the form.
  await page(`document.querySelector('.s-action').click()`)
  await wait(`document.querySelector('#new-playlist-folder') !== null`)
  await page(setNative('#new-playlist-folder', 'HTMLSelectElement', second))
  await typeName(page, 'In Second')
  await submitForm(page)
  report(await wait(`${sidebar}.includes('In Second')`) && fs.existsSync(path.join(second, 'In Second')) && !fs.existsSync(path.join(music, 'In Second')), 'the playlist is made in the music folder chosen in the form')

  // Cancel.
  await page(`document.querySelector('.s-action').click()`)
  await wait(`document.querySelector('#new-playlist-name') !== null`)
  await page(`[...document.querySelectorAll('.new-playlist .btn')].find((item) => item.textContent === 'Cancel').click()`)
  report(await wait(`document.querySelector('.new-playlist') === null`), 'Cancel closes the form without making anything')

  // A song put into the new playlist from outside shows up in it.
  fs.writeFileSync(path.join(made, 'road-song.wav'), makeWav())
  await page(clickNav('Road trip'))
  report(await wait(`${titles}.includes('road-song')`), 'a song copied into the new playlist shows up in it')

  // Tidy up what this check made, and see that the app notices.
  fs.rmSync(made, { recursive: true })
  fs.rmSync(path.join(second, 'In Second'), { recursive: true })
  report(await waitFor(page, `!${sidebar}.includes('Road trip') && !${sidebar}.includes('In Second')`, LIVE_WAIT), 'removing the folders again takes the playlists away')
}

async function removeSecondFolder(page) {
  await openSettings(page)
  await page(press('Remove folder Second'))
  await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Remove').click()`)
  await waitFor(page, `!${sidebar}.includes('Second Playlist') && ${folderNames}.length === 1`, 8000)
  await closeSettings(page)
  chosen = music
}

// ---------- Step 13: drag and drop ----------
// Real drag events are sent through Chromium's debugger (Input.dispatchDragEvent), so the page gets real File
// objects and the preload reads their paths the same way it does for a drop from Windows Explorer.

async function sendDrag(window, type, point, files) {
  await window.webContents.debugger.sendCommand('Input.dispatchDragEvent', {
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    data: { items: [], files, dragOperationsMask: 1 },
  })
}

async function dropOn(window, point, files) {
  await sendDrag(window, 'dragEnter', point, files)
  await sendDrag(window, 'dragOver', point, files)
  await sendDrag(window, 'drop', point, files)
}

const mainPoint = `(() => { const r = document.querySelector('.main').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
const listPoint = (name) => `(() => { const r = [...document.querySelectorAll('.s-item')].find((item) => item.textContent === ${JSON.stringify(name)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`

async function checkDragAndDrop(page, window) {
  const source = path.join(base, 'DropSource')
  const added = path.join(base, 'NewMusic')
  fs.rmSync(source, { recursive: true, force: true })
  fs.rmSync(added, { recursive: true, force: true })
  fs.mkdirSync(path.join(source, 'Nested'), { recursive: true })
  fs.mkdirSync(path.join(added, 'Album'), { recursive: true })
  fs.writeFileSync(path.join(source, 'new-a.wav'), makeWav())
  fs.writeFileSync(path.join(source, 'new-b.wav'), makeWav())
  fs.writeFileSync(path.join(source, 'notes.txt'), 'text')
  fs.writeFileSync(path.join(added, 'Album', 'added.wav'), makeWav())
  const target = path.join(music, 'Drop target')
  const wait = (expression, timeout = 8000) => waitFor(page, expression, timeout)
  const hint = `(document.querySelector('.drop-hint')?.textContent ?? '')`

  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
  const href = await page(`location.href`)

  // The hint and the highlight follow the drag.
  const center = await page(mainPoint)
  await sendDrag(window, 'dragEnter', center, [path.join(source, 'new-a.wav')])
  await sendDrag(window, 'dragOver', center, [path.join(source, 'new-a.wav')])
  report(await wait(`${hint}.includes('Drop a folder to add it as a music folder')`, 3000), 'dragging a file over the window shows what a drop does', await page(hint))
  await sendDrag(window, 'dragCancel', center, [path.join(source, 'new-a.wav')])
  report(await wait(`${hint} === ''`, 3000), 'the hint goes away when the drag is cancelled')

  // A playlist to drop songs on, made the way Explorer would.
  fs.mkdirSync(target)
  report(await wait(`${sidebar}.includes('Drop target')`, LIVE_WAIT), 'a new playlist folder shows up to drop songs on')
  const overList = await page(listPoint('Drop target'))
  await sendDrag(window, 'dragEnter', overList, [path.join(source, 'new-a.wav')])
  await sendDrag(window, 'dragOver', overList, [path.join(source, 'new-a.wav')])
  report(await wait(`document.querySelector('.s-item.drop-on')?.textContent === 'Drop target'`, 3000), 'a playlist lights up while songs are dragged over it', await page(`JSON.stringify({ hint: ${hint}, items: [...document.querySelectorAll('.s-item')].map((item) => item.className + ':' + item.textContent) })`))
  await sendDrag(window, 'dragCancel', overList, [path.join(source, 'new-a.wav')])
  report(await wait(`document.querySelector('.s-item.drop-on') === null && ${hint} === ''`, 3000), 'the highlight goes away when the drag is cancelled')

  // Songs on a playlist are copied.
  await dropOn(window, overList, [path.join(source, 'new-a.wav'), path.join(source, 'new-b.wav'), path.join(source, 'notes.txt')])
  report(await wait(`${noticeText}.includes('2 songs copied')`), 'dropping songs on a playlist says how many were copied', await page(noticeText))
  report((await page(noticeText)).includes('not a music file'), 'a dropped file that is not music is skipped with a plain message', await page(noticeText))
  const copiedA = path.join(target, 'new-a.wav')
  report(fs.existsSync(copiedA) && fs.existsSync(path.join(target, 'new-b.wav')) && !fs.existsSync(path.join(target, 'notes.txt')), 'both songs are in the playlist folder and the text file is not')
  report(fs.readFileSync(copiedA).equals(fs.readFileSync(path.join(source, 'new-a.wav'))) && fs.existsSync(path.join(source, 'new-a.wav')) && fs.existsSync(path.join(source, 'new-b.wav')), 'the copy is identical and the originals are still where they were (nothing moved)')
  await page(clickNav('Drop target'))
  report(await wait(`${titles}.includes('new-a') && ${titles}.includes('new-b')`, LIVE_WAIT), 'the copied songs show up in the playlist')

  // Nothing is overwritten.
  fs.writeFileSync(copiedA, 'KEEP')
  await dropOn(window, overList, [path.join(source, 'new-a.wav')])
  report(await wait(`${noticeText}.includes('already in this playlist')`), 'a name that already exists gives a clear message', await page(noticeText))
  report(fs.readFileSync(copiedA, 'utf8') === 'KEEP', 'the file that was already there is not overwritten')

  // Wrong places for a drop.
  const before = fs.readdirSync(music).length
  await dropOn(window, await page(mainPoint), [path.join(source, 'new-b.wav')])
  report(await wait(`${noticeText}.includes('onto a playlist in the sidebar')`), 'songs dropped beside the playlists are not copied anywhere and the person is told where to drop them', await page(noticeText))
  report(fs.readdirSync(music).length === before && (await page(`location.href`)) === href, 'a drop on the window neither copies nor opens the file')
  await dropOn(window, overList, [path.join(source, 'Nested')])
  report(await wait(`${noticeText}.includes('Folders cannot be copied into a playlist')`), 'a folder dropped on a playlist is refused with a plain message', await page(noticeText))
  report(fs.readdirSync(target).length === 2, 'no folder was copied into the playlist')

  // A folder on the window becomes a music folder, once.
  await dropOn(window, await page(mainPoint), [added])
  report(await wait(`${sidebar}.includes('Album')`, LIVE_WAIT), 'a folder dropped on the window is added as a music folder and its playlists appear')
  report((await page(noticeText)).includes('Music folder added'), 'the person is told the folder was added', await page(noticeText))
  await dropOn(window, await page(mainPoint), [added])
  report(await wait(`${noticeText}.includes('already a music folder')`), 'dropping the same folder again gives a clear message', await page(noticeText))
  await openSettings(page)
  report(JSON.stringify(await page(folderNames)) === JSON.stringify(['Musik', 'NewMusic']), 'the settings page lists the dropped folder once', (await page(folderNames)).join(', '))
  await page(press('Remove folder NewMusic'))
  await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Remove').click()`)
  report(await wait(`!${sidebar}.includes('Album') && ${folderNames}.length === 1`), 'the dropped folder can be removed again')
  report(fs.existsSync(path.join(added, 'Album', 'added.wav')), 'removing it leaves its files on the PC')
  await closeSettings(page)

  // Tidy up what this check made.
  window.webContents.debugger.detach()
  fs.rmSync(target, { recursive: true })
  fs.rmSync(source, { recursive: true })
  fs.rmSync(added, { recursive: true })
  report(await wait(`!${sidebar}.includes('Drop target')`, LIVE_WAIT), 'removing the folder takes the playlist away')
  await page(clickNav('All songs'))
}

// ---------- Step 8: settings page and window position ----------

const choiceValues = `['setting-start', 'setting-restart', 'setting-shuffle', 'setting-repeat'].map((id) => document.getElementById(id).value)`
const choose = (page, id, value) => page(setNative(`#${id}`, 'HTMLSelectElement', value))
const playLabel = `document.querySelector('.play').getAttribute('aria-label')`

async function checkSettingsPage(page, window) {
  await page(clickNav('The White Buffalo'))
  await sleep(100)
  await openSettings(page)

  const shape = await page(`(() => {
    const above = (id) => {
      const label = document.querySelector('label[for=' + id + ']')
      const input = document.getElementById(id)
      return label !== null && input !== null && label.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1
    }
    return {
      title: document.querySelector('.settings h1')?.textContent,
      selects: document.querySelectorAll('.settings select').length,
      above: ['setting-start', 'setting-restart', 'setting-shuffle', 'setting-repeat', 'setting-close'].every(above),
      gearOn: [...document.querySelectorAll('.s-link')].find((item) => item.textContent === 'Settings')?.classList.contains('on') === true,
      listsOn: document.querySelectorAll('.s-item.on').length,
      dataPath: document.querySelector('.data-path')?.textContent ?? '',
      values: ${choiceValues},
      addButton: [...document.querySelectorAll('.settings .btn')].some((item) => item.textContent.includes('Add folder')),
    }
  })()`)
  report(shape.title === 'Settings' && shape.selects === 5 && shape.above, 'the gear opens a settings page with five choices, each with its label above it', JSON.stringify(shape))
  report(shape.gearOn && shape.listsOn === 0, 'the gear is lit and no playlist is selected while the settings are open')
  report(same(shape.values, ['paused', '3', 'remember', 'remember']), 'the choices start with the same behaviour as before: wait paused, restart after 3 seconds, shuffle and repeat like last time', shape.values.join(', '))
  report(same(await page(folderNames), ['Musik']) && shape.addButton, 'the page lists the music folders and offers "Add folder"')
  report(shape.dataPath === path.join(base, 'userData'), 'the page names the folder where the app keeps its own data', shape.dataPath)

  // On this page the space bar presses the focused button instead of pausing the music.
  window.webContents.focus()
  await page(`${button('Remove folder Musik')}.focus()`)
  const before = await page(playLabel)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'char', keyCode: ' ' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await sleep(400)
  const asked = await page(`document.querySelector('.folder-ask') !== null`)
  report(asked && (await page(playLabel)) === before, 'the space bar on a settings button presses it and does not play or pause', `asked ${asked}`)
  await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Keep').click()`)

  // "Restart after" changes what the previous button does.
  await choose(page, 'setting-restart', '0')
  await closeSettings(page)
  await playAndWait(page, 'tone-flac')
  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  await setSlider(page, '.seek input', 20)
  await sleep(400)
  await page(press('Previous song'))
  await sleep(500)
  report((await page(nowTitle)) !== 'tone-flac', 'with "Never" the previous button goes back a song even late in a song', await page(nowTitle))

  await openSettings(page)
  await choose(page, 'setting-restart', '10')
  await closeSettings(page)
  await playAndWait(page, 'tone-flac')
  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  await setSlider(page, '.seek input', 15)
  await sleep(400)
  await page(press('Previous song'))
  await sleep(500)
  const [now] = await page(clocks)
  report((await page(nowTitle)) === 'tone-flac' && seconds(now) < 3, 'with 10 seconds the previous button restarts a song that played 15 seconds', `${await page(nowTitle)} at ${now}`)
  await setSlider(page, '.seek input', 6)
  await sleep(400)
  await page(press('Previous song'))
  await sleep(500)
  report((await page(nowTitle)) !== 'tone-flac', 'with 10 seconds it goes back a song when the song played only 6 seconds', await page(nowTitle))

  // The choices for the next start.
  await openSettings(page)
  await choose(page, 'setting-restart', '0')
  await choose(page, 'setting-start', 'playing')
  await choose(page, 'setting-shuffle', 'off')
  const saved = await waitForSavedSettings({ startPlaying: true, restartAfter: 0, shuffleAtStart: 'off', repeatAtStart: 'remember' })
  report(saved, 'the choices are saved at once', fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : 'no settings file')
  await closeSettings(page)
  await page(clickNav('The White Buffalo'))
  await sleep(100)
}

// ---------- Step 16: taskbar thumbnail buttons ----------

const thumbNow = () => thumbCalls[thumbCalls.length - 1]?.buttons ?? []
const thumbTips = () => thumbNow().map((button) => button.tooltip)
const thumbEnabled = () => thumbNow().map((button) => (button.flags ?? ['enabled']).includes('enabled'))

async function checkThumbar(page, window) {
  const first = thumbCalls[0]
  report(first !== undefined && first.ok && same(first.buttons.map((b) => b.flags), [['disabled'], ['disabled'], ['disabled']]), 'at the start, before any song is loaded, the three thumbnail buttons are set and wait', first ? JSON.stringify(first.buttons.map((b) => b.flags)) : 'never set')

  await page(clickNav('The White Buffalo'))
  await playAndWait(page, 'Wild Hunt')
  await page(press('Pause'))
  report(await until(() => same(thumbTips(), ['Previous', 'Play', 'Next'])), 'with a song loaded the buttons are Previous, Play and Next', thumbTips().join(' | '))
  report(same(thumbEnabled(), [true, true, true]), 'and all three can be pressed')
  const icons = thumbNow().map((button) => button.icon)
  const sizes = icons.map((icon) => icon.getSize(1).width)
  const doubled = icons.map((icon) => icon.toBitmap({ scaleFactor: 2 }).length)
  report(icons.every((icon) => !icon.isEmpty()) && same(sizes, [16, 16, 16]) && same(doubled, [32 * 32 * 4, 32 * 32 * 4, 32 * 32 * 4]), 'each button has a drawn icon, 16 pixels at normal scale and 32 at double', `${JSON.stringify(sizes)} ${JSON.stringify(doubled)}`)
  const playIcon = thumbNow()[1].icon.toBitmap()
  report(new Set(icons.map((icon) => icon.toBitmap().toString('base64'))).size === 3, 'the three icons look different from each other')
  report(thumbCalls.every((call) => call.ok && call.buttons.length === 3), 'Windows took every call, and there were always three buttons')

  // Pressing the real buttons controls the player.
  const buttons = () => thumbNow()
  buttons()[1].click()
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000), 'the middle button starts the song')
  report(await until(() => same(thumbTips(), ['Previous', 'Pause', 'Next'])), 'while it plays the middle button says Pause and shows the pause icon', thumbTips().join(' | '))
  report(thumbNow()[1].icon.toBitmap().compare(playIcon) !== 0, 'the pause icon is not the play icon')
  const before = await page(nowTitle)
  const callsBefore = thumbCalls.length
  buttons()[2].click()
  report(await waitFor(page, `${nowTitle} !== ${JSON.stringify(before)}`, 3000), 'the Next button goes to the next song', await page(nowTitle))
  await sleep(400)
  report(thumbCalls.length === callsBefore, 'a new song alone does not touch the taskbar again (same buttons)', `${thumbCalls.length - callsBefore} extra calls`)
  buttons()[0].click()
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(before)}`, 3000), 'the Previous button goes back', await page(nowTitle))
  buttons()[1].click()
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'the middle button pauses again')
  report(await until(() => same(thumbTips(), ['Previous', 'Play', 'Next'])), 'and says Play again')

  // The taskbar button is made again when the window returns from hiding, so the buttons are set again.
  const count = thumbCalls.length
  window.hide()
  window.showInactive()
  report(await until(() => thumbCalls.length > count && thumbCalls[thumbCalls.length - 1].ok), 'when the window is shown again the buttons are set again')
}

async function checkThumbarAfterRestart() {
  const last = thumbCalls[thumbCalls.length - 1]
  report(last !== undefined && last.ok && same(thumbEnabled(), [true, true, true]), 'after a restart the song comes back and the thumbnail buttons can be pressed', JSON.stringify(thumbEnabled()))
}

// ---------- Step 17: mini player ----------

const miniFile = path.join(base, 'userData', 'mini.json')
// The watched BrowserWindow subclass makes Electron's own window list come back empty, so the check keeps its own.
const everyWindow = []
app.on('browser-window-created', (_event, window) => everyWindow.push(window))
const liveWindows = () => everyWindow.filter((win) => !win.isDestroyed())
const miniWindow = () => liveWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().includes('mini.html')) ?? null
const miniCount = () => liveWindows().filter((win) => win.webContents.getURL().includes('mini.html')).length
const miniPage = (expression) => miniWindow().webContents.executeJavaScript(expression)
const miniTitle = `(document.querySelector('.mini-title')?.textContent ?? '')`
const miniArtist = `(document.querySelector('.mini-artist')?.textContent ?? '')`
const nowArtist = `(document.querySelector('.now-artist')?.textContent ?? '')`
const miniPress = (label) => `${button(label)}.click()`
const miniButtons = `[...document.querySelectorAll('.mini button')].filter((b) => ['Previous song', 'Play', 'Pause', 'Next song'].includes(b.getAttribute('aria-label')))`

// Opens the mini player from the player bar and gets it ready: no real mouse, no sound, page loaded.
async function openMiniFromBar(page) {
  await page(press('Mini player'))
  if (!(await until(() => miniWindow() !== null, 5000))) {
    console.log('NOTE  no mini player window; windows: ' + liveWindows().map((win) => win.webContents.getURL()).join(' | '))
    return null
  }
  const mini = miniWindow()
  mini.setIgnoreMouseEvents(true)
  mini.webContents.setAudioMuted(true)
  const loaded = await waitFor(miniPage, `document.querySelector('.mini-title') !== null`, 8000)
  if (!loaded) console.log('NOTE  the mini player page showed nothing: ' + await mini.webContents.executeJavaScript('document.documentElement.outerHTML.slice(0, 300)'))
  return loaded ? mini : null
}

async function closeMini(mini) {
  mini.close()
  await until(() => miniWindow() === null, 3000)
}

const near = (bounds, spot) => Math.abs(bounds.x - spot.x) <= 3 && Math.abs(bounds.y - spot.y) <= 3

async function checkMiniPlayer(page, window) {
  // Coming back from hiding must not take the focus from a game on the main screen.
  window.show = () => window.showInactive()
  window.focus = () => {}
  const { screen } = require('electron')

  report(miniWindow() === null && fs.existsSync(miniFile) === false, 'the mini player is closed at the start and has no remembered position yet')
  report(await page(`${button('Mini player')} !== null`), 'the player bar has a "Mini player" button')
  const hunt = await playAndWait(page, 'Wild Hunt')
  await page(press('Pause'))
  report(hunt && (await waitFor(page, `${playLabel} === 'Play'`, 3000)), 'a song is loaded and paused before the mini player opens')

  const mini = await openMiniFromBar(page)
  report(mini !== null, 'the button opens the mini player in its own window')
  if (mini === null) return

  const [width, height] = mini.getContentSize()
  report(mini.isAlwaysOnTop() && !mini.isResizable() && width === 440 && height === 88, 'it is a small always-on-top window that cannot be resized', `${width}x${height}, top ${mini.isAlwaysOnTop()}`)
  const home = screen.getDisplayMatching(window.getBounds())
  const shownOn = screen.getDisplayMatching(mini.getBounds())
  const corner = mini.getBounds()
  const area = home.workArea
  report(shownOn.id === home.id && corner.x + corner.width <= area.x + area.width && corner.y + corner.height <= area.y + area.height, 'it opens on the same screen as the main window, inside the screen area', JSON.stringify(corner))
  report(await page(`document.querySelectorAll('.song').length > 0`), 'the main window is still there (opening the mini player does not close it)')

  const song = await page(nowTitle)
  report(await waitFor(miniPage, `${miniTitle} === ${JSON.stringify(song)}`, 5000), 'it shows the title of the loaded song', `${song} | ${await miniPage(miniTitle)}`)
  report((await miniPage(miniArtist)) === (await page(nowArtist)), 'and the artist', await miniPage(miniArtist))
  report(await waitFor(miniPage, `(() => { const img = document.querySelector('.mini-cover img'); return img !== null && img.complete && img.naturalWidth > 0 })()`, 5000), 'a song with a cover shows the cover picture')
  report(await miniPage(`${button('Play')} !== null && ${button('Pause')} === null`), 'while paused the middle button says Play')
  report(await miniPage(`${miniButtons}.length === 3 && ${miniButtons}.every((b) => !b.disabled)`), 'the three player buttons can be pressed')

  // A song without a picture shows a note.
  await playAndWait(page, 'tone-wav')
  report(await waitFor(miniPage, `${miniTitle} === 'tone-wav' && ${button('Pause')} !== null`, 5000), 'a new song shows at once, and the middle button says Pause while it plays')
  report(await waitFor(miniPage, `document.querySelector('.mini-cover img') === null && document.querySelector('.mini-cover svg') !== null`, 5000), 'a song without a cover shows a note instead')
  await page(press('Pause'))
  report(await waitFor(miniPage, `${button('Play')} !== null`, 3000), 'pausing in the main window shows Play in the mini player')

  // The buttons of the mini player control the main window. (tone-wav is the last song, so Next starts from a song in the middle.)
  await playAndWait(page, 'Wild Hunt')
  await page(press('Pause'))
  await waitFor(miniPage, `${miniTitle} === 'Wild Hunt' && ${button('Play')} !== null`, 3000)
  await miniPage(miniPress('Play'))
  report(await waitFor(page, `${playLabel} === 'Pause'`, 3000), 'the mini Play button starts the song in the main window')
  report(await waitFor(miniPage, `${button('Pause')} !== null`, 3000), 'and the mini player then offers Pause')
  const before = await page(nowTitle)
  await miniPage(miniPress('Next song'))
  report(await waitFor(page, `${nowTitle} !== ${JSON.stringify(before)}`, 3000), 'the Next button goes to the next song', await page(nowTitle))
  const after = await page(nowTitle)
  report(await waitFor(miniPage, `${miniTitle} === ${JSON.stringify(after)}`, 3000), 'and the mini player shows that song', await miniPage(miniTitle))
  await miniPage(miniPress('Previous song'))
  report(await waitFor(page, `${nowTitle} === ${JSON.stringify(before)}`, 3000), 'the Previous button goes back', await page(nowTitle))
  await miniPage(miniPress('Pause'))
  report(await waitFor(page, `${playLabel} === 'Play'`, 3000), 'the mini Pause button pauses the main window')

  // "Open Brita Music" brings the main window back.
  window.hide()
  report(!window.isVisible(), 'the main window is hidden for the next try')
  await miniPage(miniPress('Open Brita Music'))
  report(await until(() => window.isVisible()), 'the "Open Brita Music" button of the mini player brings the main window back')

  // Pressing the button in the player bar again does not make a second one.
  await page(press('Mini player'))
  await sleep(500)
  report(miniCount() === 1, 'pressing the player bar button again keeps one mini player', `${miniCount()} windows`)

  // Nothing loaded: a note, and the buttons wait.
  mini.webContents.send('mini:state', { playing: false, song: null })
  report(await waitFor(miniPage, `${miniTitle} === 'Nothing is playing'`, 3000), 'with no song the mini player says "Nothing is playing"')
  report(await miniPage(`${miniButtons}.length === 3 && ${miniButtons}.every((b) => b.disabled)`), 'and its player buttons wait')

  // Moving it is remembered.
  const spot = { x: area.x + 60, y: area.y + 80 }
  mini.setPosition(spot.x, spot.y)
  const saved = await until(() => {
    try {
      return near(JSON.parse(fs.readFileSync(miniFile, 'utf8')), spot)
    } catch {
      return false
    }
  }, 4000)
  report(saved, 'moving the mini player saves its position', fs.existsSync(miniFile) ? fs.readFileSync(miniFile, 'utf8') : 'no file')

  // Closing it never stops the music.
  await page(press('Play'))
  await waitFor(page, `${playLabel} === 'Pause'`, 3000)
  const titleThen = await page(nowTitle)
  await miniPage(miniPress('Close the mini player'))
  report(await until(() => miniWindow() === null), 'the close button of the mini player closes it')
  const state = await audioState(window)
  await sleep(1200)
  const later = await audioState(window)
  report(!later.paused && later.time > state.time + 0.5 && (await page(nowTitle)) === titleThen && window.isVisible(), 'the music plays on and the main window stays', `${state.time.toFixed(1)} s then ${later.time.toFixed(1)} s`)

  // It comes back where it was left, and shows the song that plays now.
  const reopened = await openMiniFromBar(page)
  report(reopened !== null && near(reopened.getBounds(), spot), 'opened again it appears where it was left', reopened ? JSON.stringify(reopened.getBounds()) : 'did not open')
  report(await waitFor(miniPage, `${miniTitle} === ${JSON.stringify(titleThen)} && ${button('Pause')} !== null`, 5000), 'and shows the song that plays right now, with Pause')
  await page(press('Pause'))
  await waitFor(page, `${playLabel} === 'Play'`, 3000)
  if (reopened !== null) await closeMini(reopened)
}

async function checkMiniAfterRestart(page, window) {
  report(miniWindow() === null, 'after a restart the mini player is closed (it does not open by itself)')
  const stored = JSON.parse(fs.readFileSync(miniFile, 'utf8'))
  const mini = await openMiniFromBar(page)
  report(mini !== null && near(mini.getBounds(), stored), 'after a restart it opens at the remembered position', mini ? `${JSON.stringify(mini.getBounds())} vs ${JSON.stringify(stored)}` : 'did not open')
  if (mini === null) return
  const song = await page(nowTitle)
  report(song !== '' && (await waitFor(miniPage, `${miniTitle} === ${JSON.stringify(song)}`, 5000)), 'it starts from the song the main window restored', song)
  await closeMini(mini)
  report(!window.isDestroyed() && window.isVisible(), 'closing it leaves the main window alone')
}

// ---------- Step 15: tray ----------

const trayNow = () => trays[trays.length - 1]
const trayLabels = () => (trayNow()?.menu?.items ?? []).map((item) => (item.type === 'separator' ? '---' : item.label))
const trayItem = (label) => trayNow().menu.items.find((item) => item.label === label)
const trayLabelsAre = (expected) => until(() => same(trayLabels(), expected), 3000)
const trayIsOn = () => trays.length > 0 && !trayNow().isDestroyed()
let sawQuit = false

// Asks the window to close the way the close button does, without a real close for the "quit" case.
function fakeClose(window) {
  let refused = false
  window.emit('close', { preventDefault: () => { refused = true } })
  return refused
}

async function checkTray(page, window) {
  // A window coming back from the tray would take the focus, which the check must not do to a game on the main screen.
  window.show = () => window.showInactive()
  window.focus = () => {}

  await openSettings(page)
  const before = await page(`(() => { const s = document.getElementById('setting-close'); return { value: s?.value, options: [...(s?.options ?? [])].map((o) => o.textContent) } })()`)
  report(before.value === 'quit' && same(before.options, ['Quit Brita Music', 'Keep playing in the tray']), 'the settings page offers "When I close the window": quit (the default) or keep playing in the tray', JSON.stringify(before))
  report(trays.length === 0 && !fakeClose(window), 'by default there is no tray icon and the close button is left alone (the program quits)')

  await choose(page, 'setting-close', 'tray')
  report(await until(trayIsOn), 'choosing "Keep playing in the tray" puts an icon in the tray at once')
  report(await waitForSavedSettings({ closeToTray: true }), 'the choice is saved', fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : 'no settings file')
  await closeSettings(page)

  // The menu follows the player.
  await page(clickNav('The White Buffalo'))
  await playAndWait(page, 'Wild Hunt')
  await page(press('Pause'))
  report(await trayLabelsAre(['Wild Hunt - Björk', '---', 'Open Brita Music', 'Mini player', '---', 'Play', 'Next', '---', 'Quit']), 'the tray menu shows the song, Open, Mini player, Play, Next and Quit', trayLabels().join(' | '))
  report(await until(() => trayNow().tip === 'Brita Music: Wild Hunt - Björk'), 'the tray tooltip names the song', trayNow().tip)
  const enabled = ['Play', 'Next', 'Open Brita Music', 'Mini player', 'Quit'].every((label) => trayItem(label)?.enabled === true)
  report(enabled && trayItem('Wild Hunt - Björk')?.enabled === false, 'the entries can be chosen; the song line is only a label')

  trayItem('Play').click()
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000), 'the tray entry Play starts the song')
  report(await trayLabelsAre(['Wild Hunt - Björk', '---', 'Open Brita Music', 'Mini player', '---', 'Pause', 'Next', '---', 'Quit']), 'while it plays the entry says Pause', trayLabels().join(' | '))
  trayItem('Next').click()
  report(await waitFor(page, `${nowTitle} !== 'Wild Hunt'`, 3000), 'the tray entry Next goes to the next song', await page(nowTitle))
  // From here on a song that surely plays.
  await playAndWait(page, 'tone-mp3')
  await until(() => trayLabels().includes('Pause'))
  trayItem('Pause').click()
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'the tray entry Pause pauses')
  report(await until(() => trayLabels().includes('Play')), 'the entry says Play again')

  // Closing the window keeps the music going.
  await page(press('Play'))
  await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000)
  const song = await page(nowTitle)
  window.close()
  await sleep(500)
  const state = await audioState(window)
  await sleep(1200)
  const later = await audioState(window)
  report(!window.isDestroyed() && !window.isVisible(), 'the close button hides the window and the program keeps running')
  report(!later.paused && later.time > state.time + 0.5 && (await page(nowTitle)) === song, 'the music plays on while the window is hidden', `${state.time.toFixed(1)} s then ${later.time.toFixed(1)} s`)
  await seekNearEnd(page, 1.5)
  report(await waitFor(page, `${nowTitle} !== ${JSON.stringify(song)} && document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 8000), 'the hidden window goes on to the next song by itself', await page(nowTitle))
  await until(() => trayLabels().includes('Pause'))
  trayItem('Pause').click()
  report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'the tray menu still controls the player while the window is hidden')

  // The mini player opens from the tray, and its buttons reach the hidden window.
  const miniBefore = miniCount()
  trayItem('Mini player').click()
  report(await until(() => miniWindow() !== null, 5000) && miniBefore === 0, 'the tray entry "Mini player" opens the mini player while the main window is hidden')
  if (miniWindow() !== null) {
    miniWindow().setIgnoreMouseEvents(true)
    miniWindow().webContents.setAudioMuted(true)
    await waitFor(miniPage, `document.querySelector('.mini-title') !== null`, 8000)
    await miniPage(miniPress('Play'))
    report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`, 3000) && !window.isVisible(), 'the mini Play button starts the song in the hidden main window')
    await miniPage(miniPress('Pause'))
    report(await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Play'`, 3000), 'and the mini Pause button pauses it again')
    await closeMini(miniWindow())
  }

  // Ways back.
  trayNow().emit('click')
  report(await until(() => window.isVisible()), 'a click on the tray icon opens the window')
  window.close()
  await sleep(300)
  trayItem('Open Brita Music').click()
  report(await until(() => window.isVisible()), 'the tray entry "Open Brita Music" opens the window')
  window.close()
  await sleep(300)
  report(await startSecondCopy(window), 'starting the program a second time opens the hidden window and the second copy quits')

  // Back to quitting.
  await openSettings(page)
  const count = trays.length
  await choose(page, 'setting-close', 'quit')
  report(await until(() => trays[count - 1].isDestroyed()), 'choosing "Quit Brita Music" removes the tray icon')
  report(!fakeClose(window), 'with the choice off the close button is left alone again')
  await choose(page, 'setting-close', 'tray')
  report(await until(() => trays.length === count + 1 && trayIsOn()), 'choosing the tray again brings the icon back')
  report(await waitForSavedSettings({ closeToTray: true }), 'the tray choice is saved for the restart')
  await closeSettings(page)

  // The Quit entry really quits (the check cancels the quit, so the run can finish).
  app.once('before-quit', (event) => {
    event.preventDefault()
    sawQuit = true
  })
  trayItem('Quit').click()
  report(await until(() => sawQuit), 'the tray entry Quit quits the program')
}

// A second program start finds the first one running. The check starts it for real and waits for it to leave.
function startSecondCopy(window) {
  return new Promise((resolve) => {
    let shown = false
    app.once('second-instance', () => { shown = true })
    const child = spawn(process.execPath, [__filename, '--second'], { stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, 20000)
    child.on('exit', async () => {
      clearTimeout(timer)
      resolve(await until(() => shown && window.isVisible()))
    })
  })
}

async function checkTrayAfterRestart(page, window) {
  window.show = () => window.showInactive()
  window.focus = () => {}
  report(trays.length === 1 && trayIsOn(), 'after a restart the tray icon is there from the start')
  const labels = trayLabels()
  report(labels.length >= 6 && labels.includes('Open Brita Music') && labels.includes('Quit') && labels[0] !== 'Open Brita Music', 'the restored song is in the tray menu', labels.join(' | '))
  window.close()
  await sleep(500)
  report(!window.isDestroyed() && !window.isVisible(), 'after a restart the close button still hides the window')
  trayNow().emit('click')
  report(await until(() => window.isVisible()), 'and the tray icon opens it again')

  // The same step the settings page takes, sent directly because the page is busy with other checks here.
  await page(`window.brita.loadSettings().then((settings) => window.brita.saveSettings({ ...settings, closeToTray: false }))`)
  report(await until(() => !trayIsOn()), 'turning the choice off removes the tray icon')
}

async function checkCloseQuits(window) {
  sawQuit = false
  app.once('before-quit', (event) => {
    event.preventDefault()
    sawQuit = true
  })
  // The mini player shows what the main window plays, so it must not outlive that window.
  await window.webContents.executeJavaScript('window.brita.openMiniPlayer()')
  const opened = await until(() => miniWindow() !== null, 5000)
  if (opened) miniWindow().setIgnoreMouseEvents(true)
  window.close()
  report(await until(() => sawQuit), 'with the tray off the close button quits the program')
  report(opened && (await until(() => miniWindow() === null, 3000)), 'closing the main window closes the mini player with it')
}

const windowFile = path.join(base, 'userData', 'window.json')
const sameBounds = (a, b) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(a[key] - b[key]) <= 3)
let restoredBounds = null

// Moves and resizes the window, then waits until the app has saved that for the next start.
async function leaveWindowForRestart(window) {
  const start = window.getBounds()
  window.setBounds({ x: start.x + 30, y: start.y + 30, width: 1000, height: 640 })
  await sleep(300)
  const now = window.getBounds()
  fs.writeFileSync(path.join(base, 'expected-window.json'), JSON.stringify(now))
  let saved = null
  const end = Date.now() + 10000
  while (Date.now() < end) {
    try {
      saved = JSON.parse(fs.readFileSync(windowFile, 'utf8'))
      if (sameBounds(saved, now) && saved.maximized === false) break
    } catch {
      // Not written yet.
    }
    await sleep(200)
  }
  report(saved !== null && sameBounds(saved, now) && saved.maximized === false, 'the window size and position are saved after a move', `window ${JSON.stringify(now)}, saved ${JSON.stringify(saved)}`)
}

async function waitForSavedSettings(expected) {
  const end = Date.now() + 10000
  while (Date.now() < end) {
    try {
      const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
      if (Object.entries(expected).every(([key, value]) => saved[key] === value)) return true
    } catch {
      // Not written yet.
    }
    await sleep(200)
  }
  return false
}

async function leaveSettingsForRestart(page) {
  await playAndWait(page, 'tone-flac')
  await setSlider(page, '.volume-slider', 0.3)
  await page(press('Shuffle'))
  await page(`document.querySelector('button[aria-label^="Repeat"]').click()`) // off -> all
  await page(press('Pause'))
  const lastSong = path.join(music, buffalo, 'tone-flac.flac')
  const saved = await waitForSavedSettings({ volume: 0.3, muted: false, shuffle: true, repeat: 'all', lastSong })
  report(saved, 'volume, shuffle, repeat and the last song are saved', fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : 'no settings file')
}

async function checkRememberedSettings(page, window) {
  const back = await waitFor(page, `${nowTitle} === 'tone-flac'`)
  report(back, 'after a restart the last song is loaded in the player', back ? '' : `player shows "${await page(nowTitle)}", settings file: ${fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : 'none'}`)
  // Step 8: the first start chose "Continue with the last song" and "Shuffle: always off", and left repeat on "like last time".
  const playing = await waitFor(page, `document.querySelector('.play').getAttribute('aria-label') === 'Pause'`)
  const state = await audioState(window)
  report(playing && !state.paused && decodeURIComponent(state.src).includes('tone-flac') && Math.abs(state.volume - 0.3) < 0.01, 'the setting "Continue with the last song" plays it at once, at the remembered volume', `volume ${state.volume}, paused ${state.paused}`)
  report((await page(`document.querySelector('.volume-slider').value`)) === '0.3', 'the volume slider shows the remembered volume')
  report((await page(`${button('Shuffle')}.getAttribute('aria-pressed')`)) === 'false', 'the setting "Shuffle always off" wins over the shuffle that was on when the app closed')
  report((await page(`document.querySelector('button[aria-label^="Repeat"]').getAttribute('aria-label')`)) === 'Repeat: all', 'repeat "like last time" is still on "all"')

  await page(clickNav('The White Buffalo'))
  await sleep(100)
  const list = await page(titles)
  await page(press('Next song'))
  await sleep(300)
  const next = await page(nowTitle)
  report(next !== 'tone-flac' && list.includes(next) && !next.includes('loose'), 'next after a restart continues in the playlist of the remembered song', next)
  await openSettings(page)
  report(!(await page(sidebar)).includes('Second Playlist') && JSON.stringify(await page(folderNames)) === JSON.stringify(['Musik']), 'the folder removed in the first run stays gone')
  await closeSettings(page)
}

// Step 8: the choices from the first start are on the settings page again, and they still change what the player does.
async function checkRememberedChoices(page) {
  await openSettings(page)
  const values = await page(`['setting-start', 'setting-restart', 'setting-shuffle', 'setting-repeat'].map((id) => document.getElementById(id).value)`)
  report(same(values, ['playing', '0', 'off', 'remember']), 'after a restart the settings page shows the saved choices', values.join(', '))
  await closeSettings(page)

  await page(clickNav('The White Buffalo'))
  await sleep(100)
  await playAndWait(page, 'tone-flac')
  await waitFor(page, `Number(document.querySelector('.seek input').max) > 5`)
  await setSlider(page, '.seek input', 20)
  await sleep(400)
  await page(press('Previous song'))
  await sleep(500)
  const [now] = await page(clocks)
  report((await page(nowTitle)) !== 'tone-flac' && seconds(now) < 3, 'after a restart "previous" still goes back a song, even late in a song (restart time: never)', `${await page(nowTitle)} at ${now}`)
}

// Step 8: the window comes back where it was.
async function checkWindowRestored() {
  let expected = null
  try {
    expected = JSON.parse(fs.readFileSync(path.join(base, 'expected-window.json'), 'utf8'))
  } catch {
    // Reported below.
  }
  report(expected !== null && restoredBounds !== null && sameBounds(restoredBounds, expected), 'after a restart the window opens with the size and position it had when it was closed', `was ${JSON.stringify(expected)}, now ${JSON.stringify(restoredBounds)}`)
}

async function removeEveryFolder(page) {
  const started = Date.now()
  await openSettings(page)
  for (const name of ['Big', 'Musik']) {
    await page(press(`Remove folder ${name}`))
    await page(`[...document.querySelectorAll('.folder-buttons .btn')].find((item) => item.textContent === 'Remove').click()`)
    await waitFor(page, `!${folderNames}.includes(${JSON.stringify(name)})`, 20000)
  }
  report(await page(`document.querySelector('.settings').textContent.includes('No music folder yet') && [...document.querySelectorAll('.settings .btn')].some((item) => item.textContent.includes('Add folder'))`), 'with no music folder the settings page says so and still offers "Add folder"')
  await closeSettings(page)
  const first = await waitFor(page, `document.querySelector('.first-start h1')?.textContent === 'Add your music folder'`, 10000)
  report(first && fs.existsSync(path.join(music, buffalo, 'tone-wav.wav')), 'removing the last folder shows the first-start screen, files stay', `${Date.now() - started} ms for a 20,000 song folder and the first one`)
}

async function checkRestart(page, started) {
  const shownAt = await new Promise((resolve) => {
    const poll = async () => {
      if ((await page(`document.querySelectorAll('.song').length`)) > 0) resolve(Date.now() - started)
      else setTimeout(poll, 20)
    }
    void poll()
  })
  const askedForFolder = await page(`document.querySelector('.first-start') !== null`)
  report(!askedForFolder, 'after a restart the folder is remembered, no first-start screen', `songs listed after ${shownAt} ms`)

  const settled = await waitFor(page, `${titles}.includes('Brand New') && ${titles}.includes('Opus Song two')`)
  const all = await page(titles)
  report(settled && all.includes('Brand New'), 'a song added while the app was closed appears')
  report(all.includes('Opus Song two') && !all.includes('Opus Song'), 'a song whose file changed is read again')
  report(all.includes('Cached Hunt') && !all.includes('Wild Hunt'), 'unchanged songs use the remembered details without reading the files again')
  report(!all.includes('damaged'), 'a song deleted while the app was closed is gone')
  const hunt = await page(rowOf('Cached Hunt'))
  report(hunt?.artist === 'Björk' && lengthLooksRight(hunt?.length), 'remembered artist and length are shown', JSON.stringify(hunt))
}

async function checkBigFolder(page, choose) {
  makeBigFolder()
  choose(big)
  const started = Date.now()
  await openSettings(page)
  await page(addFolderClick)
  const shown = await waitFor(page, `document.querySelectorAll('.s-item').length > 200`, 60000)
  await page(clickNav('All songs'))
  await sleep(50)
  await waitFor(page, `document.querySelectorAll('.song').length > 20000`, 60000)
  report(shown, '20,000 songs in 200 playlists appear', `${Date.now() - started} ms`)
}

async function firstStart(page) {
  report(await page(`document.querySelector('.first-start h1')?.textContent === 'Add your music folder'`), 'first start asks for a folder')
  report(await page(`document.fonts.ready.then(() => document.fonts.check('700 16px Saira'))`), 'Saira font loaded')
  const steps = await page(`[...document.querySelectorAll('.first-steps li')].map((item) => item.textContent)`)
  report(steps.length === 3 && steps[0].includes('playlist') && (await page(`document.querySelectorAll('.first-start .btn').length`)) === 1 && (await page(`document.querySelector('.first-mark svg') !== null`)), 'first start explains what happens in three short lines and offers one button', steps.join(' | '))
  report(await page(`(() => { const lead = document.querySelector('.first-lead'); return lead !== null && lead.textContent.includes('only reads it') })()`), 'first start says the files stay untouched')

  await page(`document.querySelector('.first-start .btn').click()`)
  report(await waitFor(page, `document.querySelectorAll('.song').length > 0`), 'adding the folder shows songs')

  await checkLibraryScreen(page)
  const wav = path.join(music, buffalo, 'tone-wav.wav')
  await checkDetails(page)
  await checkCovers(page)
  await checkFileType(page, 'tone-wav', 'WAV')
  await checkSeek(page)
  await checkPause(page)
  await checkFileType(page, 'tone-mp3', 'MP3')
  await checkFileType(page, 'tone-flac', 'FLAC')
  await checkFileType(page, 'tone-opus', 'Opus')
  await checkFileType(page, 'tone-ogg', 'OGG with Opus inside')
  if (fs.existsSync(path.join(music, buffalo, 'recorded-m4a.m4a'))) await checkFileType(page, 'recorded-m4a', 'M4A')
  await checkBadFiles(page)
  await checkAccess(wav)

  await guard('next and previous', () => checkNextPrevious(page))
  await guard('autoplay', () => checkAutoplay(page))
  await guard('repeat', () => checkRepeat(page))
  await guard('shuffle', () => checkShuffle(page))
  await guard('play list buttons', () => checkPlayList(page))
  await guard('queue', () => checkQueue(page))
  await guard('song menu', () => checkSongMenu(page))
  await guard('favorites', () => checkFavorites(page))
  await guard('play history', () => checkHistory(page))
  await guard('volume', () => checkVolume(page, window0))
  await guard('sound output', () => checkOutput(page, window0))
  await guard('sleep timer', () => checkSleepTimer(page, window0))
  await guard('sleep after song', () => checkSleepAfterSong(page, window0))
  await guard('space bar', () => checkSpaceBar(page, window0))
  await guard('media keys', () => checkMediaKeys(page, window0))
  await guard('playlist header', () => checkPlaylistHeader(page))
  await guard('search', () => checkSearch(page, window0))
  await guard('sort', () => checkSort(page))
  await guard('playing row', () => checkPlayingRow(page))
  await guard('remove folder', () => checkRemoveFolder(page, window0))
  await guard('live folders', () => checkLiveFolders(page, window0))
  await guard('missing folder', () => checkMissingFolder(page))
  await guard('new playlist', () => checkNewPlaylist(page))
  await guard('second folder cleanup', () => removeSecondFolder(page))
  await guard('drag and drop', () => checkDragAndDrop(page, window0))
  await guard('settings page', () => checkSettingsPage(page, window0))
  await guard('download page', () => checkDownloadPage(page, window0))
  await guard('thumbnail buttons', () => checkThumbar(page, window0))
  await guard('mini player', () => checkMiniPlayer(page, window0))
  await guard('tray', () => checkTray(page, window0))
  await guard('remembered settings', () => leaveSettingsForRestart(page))
  await guard('remembered output', () => chooseOutputForRestart(page, window0))
  await guard('sleep timer left running', () => leaveSleepForRestart(page))
  await guard('window position', () => leaveWindowForRestart(window0))

  if (screenshot) {
    await page(clickSong('Wild Hunt'))
    await sleep(1500)
    fs.writeFileSync(screenshot, (await window0.webContents.capturePage()).toPNG())
  }
  report(await waitForSavedLibrary(), 'the library is saved for the next start')
}

let window0

async function run(window, started) {
  window0 = window
  window.webContents.setAudioMuted(true)
  const page = (expression) => window.webContents.executeJavaScript(expression)

  if (window.webContents.isLoading()) {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
  }
  if (again) {
    await checkRestart(page, started)
    await guard('remembered favorites', () => checkRememberedFavorites(page))
    await checkRememberedSettings(page, window)
    await guard('remembered output', () => checkRememberedOutput(page, window))
    await guard('output changes', () => checkOutputChanges(page, window))
    await guard('sleep timer after restart', () => checkSleepGone(page))
    await guard('remembered choices', () => checkRememberedChoices(page))
    await guard('window position', () => checkWindowRestored())
    await guard('remembered history', () => checkRememberedHistory(page))
    await guard('thumbnail buttons after restart', () => checkThumbarAfterRestart())
    await guard('mini player after restart', () => checkMiniAfterRestart(page, window))
    await guard('tray after restart', () => checkTrayAfterRestart(page, window))
    await checkBigFolder(page, (folder) => { chosen = folder })
    await removeEveryFolder(page)
    await guard('close quits', () => checkCloseQuits(window))
  } else {
    await firstStart(page)
  }
}

async function recordSample(mimeType) {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  win.webContents.setAudioMuted(true)
  const base64 = await win.webContents.executeJavaScript(`(async () => {
    if (!MediaRecorder.isTypeSupported(${JSON.stringify(mimeType)})) return null
    const context = new AudioContext()
    const target = context.createMediaStreamDestination()
    const tone = context.createOscillator()
    tone.connect(target)
    tone.start()
    const recorder = new MediaRecorder(target.stream, { mimeType: ${JSON.stringify(mimeType)} })
    const parts = []
    recorder.ondataavailable = (event) => parts.push(event.data)
    const done = new Promise((resolve) => { recorder.onstop = resolve })
    recorder.start()
    await new Promise((resolve) => setTimeout(resolve, 4000))
    recorder.stop()
    await done
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  })()`, true)
  win.destroy()
  return base64 === null ? null : Buffer.from(base64, 'base64')
}

async function makeSongs() {
  put('loose.wav', makeWav())
  put('notes.txt', 'not music')
  put(`${buffalo}/tone-wav.wav`, makeWav())
  put(`${buffalo}/tone-mp3.mp3`, makeMp3())
  put(`${buffalo}/tone-flac.flac`, makeFlac())
  put(`${buffalo}/tone-opus.opus`, makeOpus())
  put(`${buffalo}/tone-ogg.ogg`, makeOpus())
  put(`${buffalo}/Album 1/nested.mp3`, makeMp3())
  put(`${buffalo}/Album 1/cover.png`, makePng())
  put(`${buffalo}/Tagged/with-tags.mp3`, makeMp3({ title: 'Wild Hunt', artist: 'Björk', album: 'Debut', picture: makePng() }))
  put(`${buffalo}/Tagged/with-tags.flac`, makeFlac({ title: 'Flac Song', artist: 'Sigur Rós', album: 'Ágætis byrjun' }))
  put(`${buffalo}/Tagged/with-tags.opus`, makeOpus({ title: 'Opus Song', artist: 'Someone', album: 'Else' }))
  put(`${buffalo}/damaged.mp3`, 'this is not a song')
  put(`${buffalo}/old-format.wma`, 'this is not a song')
  fs.mkdirSync(path.join(music, 'Empty Playlist'), { recursive: true })

  let m4a = null
  try {
    m4a = await recordSample('audio/mp4;codecs=mp4a.40.2')
  } catch (error) {
    console.log(`NOTE  the helper window for M4A failed (${error.code ?? error.message})`)
  }
  if (m4a === null) console.log('NOTE  M4A could not be generated here, so it is not tested')
  else put(`${buffalo}/recorded-m4a.m4a`, m4a)
}

// Between the two starts: change what the app cannot know about, and plant a marker in the remembered
// library, so a restart that re-read every file would lose the marker.
function changeThingsWhileClosed() {
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  const hunt = cache.library.songs.find((song) => song.title === 'Wild Hunt')
  hunt.title = 'Cached Hunt'
  fs.writeFileSync(cacheFile, JSON.stringify(cache))

  // The history keeps a record of a file that is deleted while the app is closed: it must stay saved but not be shown.
  if (fs.existsSync(historyFile)) {
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
    const deleted = path.join(fs.realpathSync.native(path.join(music, buffalo)), 'damaged.mp3')
    history.plays.push({ path: deleted, count: 99, last: Date.now() })
    fs.writeFileSync(historyFile, JSON.stringify(history))
  }

  put(`${buffalo}/Tagged/with-tags.opus`, makeOpus({ title: 'Opus Song two', artist: 'Someone', album: 'Else' }))
  put(`${buffalo}/Tagged/brand-new.mp3`, makeMp3({ title: 'Brand New' }))
  fs.rmSync(path.join(music, buffalo, 'damaged.mp3'))
}

// Cleaning up must never stop the check from ending: Windows keeps some of the app's own files locked until it exits.
function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    console.log(`NOTE  could not remove ${target} (${error.code}); the next run clears it`)
  }
}

function finish(code) {
  // The first start leaves its data for the restart; the last one cleans up.
  if (again || code !== 0) {
    for (const folder of [music, big, second, path.join(base, 'outside.mp3'), base]) removeQuietly(folder)
  }
  app.exit(code)
}

// The app must load before Electron is ready, because it registers its song address scheme then.
const created = new Promise((resolve) => app.once('browser-window-created', (_event, window) => resolve(window)))
if (again) changeThingsWhileClosed()
const startedAt = Date.now()
// Step 20: the Download page must never reach youtube.com in a check. Its start page is a closed local port, and the app accepts the host
// 127.0.0.1 for this run only (it ignores this setting in the installed program). The check loads its own test site into the view.
process.env.BRITA_TEST_BROWSER_HOME = 'http://127.0.0.1:49999/'
// BRITA_MAIN points the check at the packed program (`dist/win-unpacked/resources/app.asar/out/main/index.js`) instead of `out/`.
require(process.env.BRITA_MAIN ?? path.join(__dirname, '../out/main/index.js'))

app.whenReady().then(async () => {
  const window = await created
  // Where the app put its window by itself, before this check moves it to the second screen.
  restoredBounds = window.getBounds()
  // A click by a person on this window would disturb the check.
  window.setIgnoreMouseEvents(true)
  // With a second screen, the check window goes there and gives the focus back, so a game on the main screen is left alone.
  const { screen } = require('electron')
  const primary = screen.getPrimaryDisplay()
  const other = screen.getAllDisplays().find((display) => display.id !== primary.id)
  if (other) {
    const { x, y, width, height } = other.workArea
    window.setBounds({ x, y, width: Math.min(1280, width), height: Math.min(800, height) })
    window.blur()
    console.log(`NOTE  check window placed on the second screen (${other.bounds.width}x${other.bounds.height})`)
  }
  if (!again) await makeSongs()
  await run(window, startedAt)
  console.log(failures === 0 ? 'RESULT PASS' : `RESULT FAIL: ${failures} checks failed`)
  finish(failures === 0 ? 0 : 1)
}).catch((error) => {
  console.error('RESULT FAIL: the check crashed', error)
  finish(1)
})
