// Drives the real built app against a fake update server on this PC (nothing goes to GitHub).
// Run one scenario per start:  electron tests/update-check.cjs newer | same | offline
//   newer   the server offers version 99.0.0: banner, "Later", download with progress, restart offered
//   same    the server offers the version that runs: no banner at start, "latest version" when asked
//   offline the server is switched off: no error at start, a plain message when asked
// The restart itself is stubbed: the "installer" is only a file of random bytes and must never run.

const { app, BrowserWindow } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const scenario = process.argv.find((arg) => ['newer', 'same', 'offline'].includes(arg))
if (scenario === undefined) {
  console.error('RESULT FAIL: name a scenario: newer, same or offline')
  process.exit(1)
}

const base = path.join(os.tmpdir(), `brita-update-check-${scenario}`)
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(base, { recursive: true })
app.setPath('userData', path.join(base, 'userData'))
fs.mkdirSync(path.join(base, 'userData'), { recursive: true })
// The updater keeps its download under LOCALAPPDATA; here that is inside the temporary folder.
process.env.LOCALAPPDATA = path.join(base, 'local')
const cacheDir = path.join(base, 'local', 'brita-music-updater-test')

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let failures = 0
function report(ok, name, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
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

// ---------- the fake update server ----------

const INSTALLER = 'Brita-Music-Setup-99.0.0.exe'
const installer = crypto.randomBytes(1_200_000)
const requested = []
let server = null

function latestYml(version) {
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64')
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${INSTALLER}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${INSTALLER}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-11-05T00:00:00.000Z'",
    '',
  ].join('\n')
}

// The installer arrives slowly, so the progress bar can be seen between 0 and 100.
function sendSlowly(response) {
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length })
  const parts = 12
  const size = Math.ceil(installer.length / parts)
  let sent = 0
  const next = () => {
    if (sent >= installer.length) return response.end()
    response.write(installer.subarray(sent, sent + size))
    sent += size
    setTimeout(next, 350)
  }
  next()
}

function startServer(offeredVersion) {
  return new Promise((resolve) => {
    server = http.createServer((request, response) => {
      const name = decodeURIComponent(new URL(request.url, 'http://x').pathname.slice(1))
      requested.push(name)
      if (name === 'latest.yml') {
        response.writeHead(200, { 'Content-Type': 'text/yaml' })
        return response.end(latestYml(offeredVersion()))
      }
      if (name === INSTALLER) return sendSlowly(response)
      response.writeHead(404)
      response.end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

// ---------- reading the window ----------

const bannerText = `(document.querySelector('.update-bar-text span')?.textContent ?? '')`
const hasBanner = `document.querySelector('.update-bar') !== null`
const barButtons = `[...document.querySelectorAll('.update-bar .btn')].map((item) => item.textContent.trim())`
const settingsButtons = `[...document.querySelectorAll('.settings .btn')].map((item) => item.textContent.trim())`
const updateLine = `(document.querySelector('.update-text')?.textContent ?? '')`
const clickIn = (area, label) => `[...document.querySelectorAll('${area} .btn')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}).click()`
const onSettings = `document.querySelector('.settings') !== null`
const gear = `document.querySelector('.s-link')`

async function openSettings(page) {
  if (!(await page(onSettings))) await page(`${gear}.click()`)
  await waitFor(page, onSettings, 3000)
}
async function closeSettings(page) {
  if (await page(onSettings)) await page(`${gear}.click()`)
  await waitFor(page, `!(${onSettings})`, 3000)
}

// ---------- scenarios ----------

// With BRITA_SCREENSHOT=<folder> the check saves pictures of what the person sees.
async function shoot(name) {
  const folder = process.env.BRITA_SCREENSHOT
  if (!folder) return
  await mainWindow.webContents.executeJavaScript(`document.getElementById('settings-update')?.scrollIntoView({ block: 'center' })`)
  await sleep(200)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG())
}
let mainWindow = null

async function checkNewer(page) {
  const found = await waitFor(page, hasBanner, 15000)
  report(found, 'at start the banner offers the newer version')
  if (!found) return
  report((await page(bannerText)) === 'Version 99.0.0 is available. Download and restart?', 'the banner asks "Version 99.0.0 is available. Download and restart?"', await page(bannerText))
  const buttons = await page(barButtons)
  report(buttons.includes('Update') && buttons.includes('Later') && buttons.length === 2, 'the banner offers Update and Later', buttons.join(', '))
  await sleep(1500)
  await shoot('update-banner')
  report(!requested.includes(INSTALLER) && !fs.existsSync(cacheDir), 'nothing is downloaded before the click', requested.join(', '))

  await page(clickIn('.update-bar', 'Later'))
  await sleep(300)
  report(!(await page(hasBanner)), '"Later" hides the banner')

  await openSettings(page)
  const shown = await page(`({
    panel: [...document.querySelectorAll('.settings h2')].map((item) => item.textContent),
    version: [...document.querySelectorAll('.settings .panel')].find((panel) => panel.querySelector('h2')?.textContent === 'Updates')?.querySelector('.muted')?.textContent ?? '',
    line: ${updateLine},
    buttons: ${settingsButtons},
  })`)
  const expectedVersion = `Brita Music ${app.getVersion()}.`
  report(shown.panel.includes('Updates') && shown.version.startsWith(expectedVersion), 'the settings page has an Updates panel with the current version', shown.version.slice(0, 60))
  report(shown.line === 'Version 99.0.0 is available. Download and restart?' && shown.buttons.includes('Update') && shown.buttons.includes('Check for updates'), 'after "Later" the settings page still offers Update and Check for updates', `${shown.line} | ${shown.buttons.join(', ')}`)

  await shoot('update-settings-available')
  await page(clickIn('.settings', 'Update'))
  const sawProgress = await waitFor(page, `(() => { const bar = document.querySelector('.update-progress'); return bar !== null && bar.value > 0 && bar.value < 100 })()`, 20000)
  report(sawProgress, 'the download shows progress between 0 and 100', await page(updateLine))
  const ready = await waitFor(page, `${updateLine} === 'Version 99.0.0 is ready. Restart to install it.'`, 30000)
  report(ready, 'when the download is done the page says the version is ready', await page(updateLine))
  await shoot('update-settings-ready')
  const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir, { recursive: true }).map(String) : []
  const kept = files.find((file) => file.endsWith(INSTALLER))
  const size = kept === undefined ? -1 : fs.statSync(path.join(cacheDir, kept)).size
  report(size === installer.length, 'the downloaded file has the size announced by the server', `${size} of ${installer.length}`)
  report((await page(settingsButtons)).includes('Restart now') && (await page(settingsButtons)).includes('Check for updates'), 'Restart now is offered', (await page(settingsButtons)).join(', '))
  const disabled = await page(`[...document.querySelectorAll('.settings .btn')].find((item) => item.textContent.trim() === 'Check for updates').disabled`)
  report(disabled === true, 'Check for updates waits while a version is ready')

  await closeSettings(page)
  await sleep(200)
  report(!(await page(hasBanner)), 'back on the song list the banner stays hidden, because "Later" was pressed for this version')
}

async function checkRestartButton(page) {
  const { autoUpdater } = require('electron-updater')
  let calls = 0
  autoUpdater.quitAndInstall = () => { calls++ }
  await openSettings(page)
  await page(clickIn('.settings', 'Restart now'))
  await sleep(500)
  report(calls === 1, 'Restart now asks the updater to restart and install, once (stubbed, nothing runs)', `${calls} calls`)
}

async function checkSame(page) {
  await sleep(4000)
  report(requested.includes('latest.yml'), 'the app looked at the server at start', requested.join(', '))
  report(!(await page(hasBanner)), 'no banner when the server offers the version that runs')
  await openSettings(page)
  report((await page(updateLine)) === '', 'the settings page says nothing until asked')
  await page(clickIn('.settings', 'Check for updates'))
  const answered = await waitFor(page, `${updateLine} === 'You have the latest version.'`, 8000)
  report(answered, 'asking says "You have the latest version."', await page(updateLine))
  report(!(await page(hasBanner)) && (await page(`document.querySelector('.settings .message.err') === null`)), 'no banner and no error')
}

async function checkOffline(page) {
  await sleep(4000)
  report(!(await page(hasBanner)), 'no banner when the server cannot be reached')
  await openSettings(page)
  report((await page(updateLine)) === '' && (await page(`document.querySelector('.settings .message.err') === null`)), 'no error is shown at start when there is no connection')
  await page(clickIn('.settings', 'Check for updates'))
  const answered = await waitFor(page, `document.querySelector('.settings .message.err') !== null`, 15000)
  const message = await page(`document.querySelector('.settings .message.err')?.textContent ?? ''`)
  report(answered && message === 'Brita Music could not look for updates. Check your internet connection and try again.', 'asking shows a plain message', message)
  report(!/ECONN|ENOTFOUND|net::|Error/.test(message), 'the message holds no technical text')
  const enabled = await page(`[...document.querySelectorAll('.settings .btn')].find((item) => item.textContent.trim() === 'Check for updates').disabled === false`)
  report(enabled, 'the button works again after a failed check')
}

// ---------- start ----------

async function main() {
  if (scenario !== 'offline') {
    const port = await startServer(() => (scenario === 'newer' ? '99.0.0' : app.getVersion()))
    process.env.BRITA_UPDATE_URL = `http://127.0.0.1:${port}/`
  } else {
    // A port nobody listens on: the connection is refused at once.
    process.env.BRITA_UPDATE_URL = 'http://127.0.0.1:9/'
  }
  const created = new Promise((resolve) => app.once('browser-window-created', (_event, window) => resolve(window)))
  require(path.join(__dirname, '../out/main/index.js'))
  await app.whenReady()
  const window = await created
  mainWindow = window
  window.setIgnoreMouseEvents(true)
  const { screen } = require('electron')
  const primary = screen.getPrimaryDisplay()
  const other = screen.getAllDisplays().find((display) => display.id !== primary.id)
  if (other) {
    const { x, y, width, height } = other.workArea
    window.setBounds({ x, y, width: Math.min(1280, width), height: Math.min(800, height) })
    window.blur()
  }
  if (window.webContents.isLoading()) await new Promise((resolve) => window.webContents.once('did-finish-load', resolve))
  const page = (expression) => window.webContents.executeJavaScript(expression)

  try {
    if (scenario === 'newer') {
      await checkNewer(page)
      await checkRestartButton(page)
    } else if (scenario === 'same') await checkSame(page)
    else await checkOffline(page)
  } catch (error) {
    report(false, 'the check crashed', String(error && error.message ? error.message : error).split(/\r?\n/)[0])
  }
}

function finish(code) {
  if (server !== null) server.close()
  try { fs.rmSync(base, { recursive: true, force: true }) } catch { console.log(`NOTE  could not remove ${base}; the next run clears it`) }
  app.exit(code)
}

main().then(() => {
  console.log(failures === 0 ? `RESULT PASS (${scenario})` : `RESULT FAIL (${scenario}): ${failures} checks failed`)
  finish(failures === 0 ? 0 : 1)
}).catch((error) => {
  console.error('RESULT FAIL: the check crashed', error)
  finish(1)
})
