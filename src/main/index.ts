import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, protocol, screen, shell, type WebContents } from 'electron'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { HOME_URL, sanitizeBounds } from './browserModel.ts'
import { createBrowserPane, type BrowserPane } from './browserPane.ts'
import { sanitizeVideoCommand } from './videoModel.ts'
import { createVideoRemote, type VideoRemote } from './videoRemote.ts'
import { serveCover } from './covers.ts'
import { describeSongs, type KnownMap } from './describe.ts'
import { handleDrop } from './drop.ts'
import { MEDIA_SCHEME, serveSong } from './media.ts'
import { isMiniKey } from './miniModel.ts'
import { createMiniPlayer } from './miniPlayer.ts'
import { loadCache, loadFavorites, loadFolders, loadHistory, loadSettings, sanitizeFavorites, sanitizePlays, saveCache, saveFavorites, saveFolders, saveHistory, saveSettings, sanitizeSettings, type Stamp } from './persist.ts'
import { createPlaylist } from './playlist.ts'
import { buildLibrary, scanFolder } from './scan.ts'
import { findSong, isSongPath } from './songActions.ts'
import { createThumbar, type ThumbarController } from './thumbar.ts'
import { createTrayController } from './tray.ts'
import { sanitizeReport } from './trayMenu.ts'
import { startUpdates } from './updateSetup.ts'
import { createWatcher } from './watch.ts'
import { DEFAULT_SIZE, loadWindowState, MIN_HEIGHT, MIN_WIDTH, saveWindowState, type WindowState } from './windowState.ts'
import type { CreateResult, DropResult, Library, MediaKey, Progress } from '../shared/types.ts'
import trayIcon from '../../build/icon.ico?asset'

const SAVE_EVERY_MS = 15000

// With the window hidden in the tray, starting the program again must open that window, not a second copy.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.error('Brita Music is already running.')
  app.quit()
}

let mainWindow: BrowserWindow | null = null
/** The browser view of the Download page. It belongs to the main window. */
let browser: BrowserPane | null = null
/** Reads and controls the video that plays in the browser view. */
let video: VideoRemote | null = null
let thumbar: ThumbarController | null = null
/** Set once the program is really leaving, so closing the window no longer hides it in the tray. */
let quitting = false

/** Brings the window back from the tray or from behind other windows. */
function showWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendMediaKey(key: MediaKey): void {
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:key', key)
}

const mini = createMiniPlayer({
  preload: path.join(__dirname, '../preload/index.js'),
  positionFile: () => path.join(app.getPath('userData'), 'mini.json'),
  load(window) {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void window.loadURL(`${devUrl}/mini.html`)
    else void window.loadFile(path.join(__dirname, '../renderer/mini.html'))
  },
  anchor: () => mainWindow,
})

const tray = createTrayController(trayIcon, {
  open: showWindow,
  mini: () => mini.open(),
  playPause: () => sendMediaKey('play-pause'),
  next: () => sendMediaKey('next'),
  quit: () => app.quit(),
})

let folders: string[] = []
let remembered: Library | null = null
let known: KnownMap = new Map()
let refreshCount = 0
/** The window that shows the library; the folder watcher reports to it. */
let shownIn: WebContents | null = null
/** The library as the window last got it, so a change-free look at the folders does not redraw the list. */
let lastSent = ''

const watcher = createWatcher(() => {
  if (shownIn !== null && !shownIn.isDestroyed()) void refresh(shownIn, true)
})

protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

const foldersFile = () => path.join(app.getPath('userData'), 'folders.json')
const cacheFile = () => path.join(app.getPath('userData'), 'library-cache.json')
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const windowFile = () => path.join(app.getPath('userData'), 'window.json')
const favoritesFile = () => path.join(app.getPath('userData'), 'favorites.json')
const historyFile = () => path.join(app.getPath('userData'), 'history.json')

function sameFolders(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((folder, index) => folder.toLowerCase() === b[index].toLowerCase())
}

/** Reads what the last session left behind. Anything unreadable just means the library is built again. */
async function restoreState(): Promise<void> {
  try {
    folders = await loadFolders(foldersFile())
    const cache = await loadCache(cacheFile())
    if (cache === null) return
    remembered = cache.library
    for (const song of cache.library.songs) {
      const stamp = cache.stamps[song.path.toLowerCase()]
      if (stamp !== undefined) {
        known.set(song.path.toLowerCase(), {
          details: { title: song.title, artist: song.artist, album: song.album, duration: song.duration },
          stamp,
        })
      }
    }
  } catch (error) {
    console.error('Could not read the remembered library', error)
  }
}

function rememberedLibrary(): Library {
  if (remembered !== null && sameFolders(remembered.folders, folders)) return remembered
  return { folders, playlists: [], songs: [], unreadable: [], missing: [] }
}

function stampsOf(map: KnownMap): Record<string, Stamp> {
  return Object.fromEntries([...map].map(([id, entry]) => [id, entry.stamp]))
}

function remember(library: Library, map: KnownMap): void {
  remembered = library
  saveCache(cacheFile(), library, stampsOf(map)).catch((error: unknown) => {
    console.error('Could not save the library for the next start', error)
  })
}

/**
 * Scans the music folders, then reads song details in the background and reports to the window.
 * A `quiet` look (started by the folder watcher) tells the window only if something is different.
 */
async function refresh(sender: WebContents, quiet = false): Promise<void> {
  const id = ++refreshCount
  const cancelled = () => id !== refreshCount || sender.isDestroyed()
  const send = (channel: string, value: Library | Progress | null) => {
    if (sender.isDestroyed()) return
    if (channel === 'library:updated') {
      const signature = JSON.stringify(value)
      if (quiet && signature === lastSent) return
      lastSent = signature
    }
    sender.send(channel, value)
  }

  try {
    const base = buildLibrary(await Promise.all(folders.map(scanFolder)))
    let lastSave = Date.now()
    const result = await describeSongs(base.songs, known, {
      isCancelled: cancelled,
      onSnapshot(songs, progress, readSoFar) {
        if (cancelled()) return
        const library = { ...base, songs }
        send('library:updated', library)
        send('library:progress', progress)
        if (progress !== null && Date.now() - lastSave >= SAVE_EVERY_MS) {
          lastSave = Date.now()
          remember(library, readSoFar)
        }
      },
    })
    if (cancelled()) {
      for (const [key, entry] of result.known) known.set(key, entry)
      return
    }

    known = result.known
    const library = { ...base, songs: result.songs }
    if (result.read > 0) send('library:updated', library)
    send('library:progress', null)
    remember(library, known)
  } catch (error) {
    console.error('Reading the music folders failed', error)
    send('library:progress', null)
  }
}

async function addFolder(window: BrowserWindow): Promise<boolean> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose your music folder',
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return false

  await adoptFolder(await realpath(result.filePaths[0]))
  void refresh(window.webContents)
  return true
}

/** Remembers a music folder (given as its real path) unless it is known already. */
async function adoptFolder(folder: string): Promise<void> {
  if (folders.some((item) => item.toLowerCase() === folder.toLowerCase())) return
  const next = [...folders, folder]
  await saveFolders(foldersFile(), next)
  folders = next
  watcher.sync(folders)
}

/** Something was dropped on the window: folders become music folders, songs dropped on a playlist are copied into it. */
async function dropped(paths: unknown, playlist: unknown, sender: WebContents): Promise<DropResult> {
  const result = await handleDrop(folders, paths, playlist, adoptFolder)
  if (result.added > 0 || result.copied > 0) void refresh(sender)
  return result
}

/** Makes the app forget a music folder. Nothing on disk is touched. */
async function removeFolder(folder: string, sender: WebContents): Promise<void> {
  const next = folders.filter((item) => item.toLowerCase() !== folder.toLowerCase())
  if (next.length === folders.length) return
  await saveFolders(foldersFile(), next)
  folders = next
  watcher.sync(folders)
  void refresh(sender)
}

/** Makes a new folder in a music folder. The watcher would notice it too; this shows it at once. */
async function newPlaylist(folder: unknown, name: unknown, sender: WebContents): Promise<CreateResult> {
  const result = await createPlaylist(folders, folder, name)
  if (result.ok) void refresh(sender)
  return result
}

let settingsWrite: Promise<void> = Promise.resolve()

/** The tray icon follows the setting. Without the icon the window cannot be hidden, so it comes back. */
function applyTraySetting(keepInTray: boolean): void {
  tray.setEnabled(keepInTray)
  if (!tray.isActive() && mainWindow !== null && !mainWindow.isDestroyed() && !mainWindow.isVisible()) showWindow()
}

function storeSettings(data: unknown): void {
  const settings = sanitizeSettings(data)
  applyTraySetting(settings.closeToTray)
  settingsWrite = settingsWrite
    .then(() => saveSettings(settingsFile(), settings))
    .catch((error: unknown) => console.error('Could not save the settings', error))
}

let favoritesWrite: Promise<void> = Promise.resolve()

function storeFavorites(data: unknown): void {
  const songs = sanitizeFavorites({ songs: data })
  favoritesWrite = favoritesWrite
    .then(() => saveFavorites(favoritesFile(), songs))
    .catch((error: unknown) => console.error('Could not save the favorites', error))
}

let historyWrite: Promise<void> = Promise.resolve()

function storeHistory(data: unknown): void {
  const plays = sanitizePlays({ plays: data })
  historyWrite = historyWrite
    .then(() => saveHistory(historyFile(), plays))
    .catch((error: unknown) => console.error('Could not save the play history', error))
}

const MEDIA_KEYS: Array<[accelerator: string, key: MediaKey]> = [
  ['MediaPlayPause', 'play-pause'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'previous'],
  ['MediaStop', 'stop'],
]

/**
 * Off: on Windows the media keys and the volume flyout are handled by the page's media session (see
 * `connectMediaSession` in the store). Registering the keys here as well would take them away from it.
 */
const USE_GLOBAL_MEDIA_KEYS = false

/** The keyboard's media keys control the player even while another program has the focus. */
function registerMediaKeys(window: BrowserWindow): void {
  for (const [accelerator, key] of MEDIA_KEYS) {
    const registered = globalShortcut.register(accelerator, () => {
      if (!window.isDestroyed()) window.webContents.send('media:key', key)
    })
    if (!registered) console.error(`The media key ${accelerator} is used by another program and does not work here.`)
  }
}

const SAVE_WINDOW_AFTER_MS = 400

/** Remembers the size, position and maximized state, so the next start opens the window in the same place. */
function rememberWindow(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    if (window.isDestroyed()) return
    const { x, y, width, height } = window.getNormalBounds()
    try {
      saveWindowState(windowFile(), { x, y, width, height, maximized: window.isMaximized() })
    } catch (error) {
      console.error('Could not save the window position', error)
    }
  }
  const saveSoon = () => {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_WINDOW_AFTER_MS)
  }
  window.on('resize', saveSoon)
  window.on('move', saveSoon)
  window.on('maximize', saveSoon)
  window.on('unmaximize', saveSoon)
  window.on('close', save)
}

/** With the tray on, the close button hides the window and the music plays on. Quit in the tray menu really ends the program. */
function keepInTrayOnClose(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (quitting || !tray.isActive()) return
    event.preventDefault()
    window.hide()
  })
  // Windows must be able to shut down: a window that refuses to close would hold it up.
  window.on('session-end', () => { quitting = true })
}

function createWindow(): BrowserWindow {
  const screens = screen.getAllDisplays().map((display) => display.workArea)
  let saved: WindowState | null = null
  try {
    saved = loadWindowState(windowFile(), screens)
  } catch (error) {
    console.error('Could not read the window position', error)
  }
  const window = new BrowserWindow({
    width: saved?.width ?? DEFAULT_SIZE.width,
    height: saved?.height ?? DEFAULT_SIZE.height,
    ...(saved?.x === undefined ? {} : { x: saved.x, y: saved.y }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: '#1B1B1B',
    title: 'Brita Music',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (saved?.maximized) window.maximize()
  rememberWindow(window)
  keepInTrayOnClose(window)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  return window
}

// Chromium inside Electron leaves the hardware media keys off; this switches them on for the page's media session.
// The keys only reach the app once a song has played (tested by Chris, 2026-11-05).
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')

app.on('second-instance', showWindow)
app.on('before-quit', () => { quitting = true })

app.whenReady().then(async () => {
  if (!gotLock) return
  Menu.setApplicationMenu(null)
  await restoreState()
  protocol.handle(MEDIA_SCHEME, (request) => {
    const isCover = new URL(request.url).host === 'cover'
    return isCover ? serveCover(request, () => folders) : serveSong(request, () => folders)
  })
  ipcMain.handle('library:load', (event) => {
    shownIn = event.sender
    lastSent = ''
    watcher.sync(folders)
    if (folders.length > 0) void refresh(event.sender)
    return rememberedLibrary()
  })
  ipcMain.handle('library:add-folder', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) throw new Error('The app window is gone.')
    return addFolder(window)
  })
  ipcMain.handle('library:remove-folder', (event, folder: unknown) => {
    if (typeof folder !== 'string') throw new Error('A folder path is needed.')
    return removeFolder(folder, event.sender)
  })
  ipcMain.handle('library:create-playlist', (event, folder: unknown, name: unknown) => newPlaylist(folder, name, event.sender))
  ipcMain.handle('drop:items', (event, paths: unknown, playlist: unknown) => dropped(paths, playlist, event.sender))
  ipcMain.handle('song:show-in-folder', async (_event, file: unknown) => {
    const found = await findSong(file, folders)
    if (found === null) return false
    shell.showItemInFolder(found)
    return true
  })
  ipcMain.handle('song:copy-path', async (_event, file: unknown) => {
    if (!isSongPath(file, folders)) return false
    try {
      await clipboard.writeText(file)
      return true
    } catch (error) {
      console.error('Could not copy the path', error)
      return false
    }
  })
  ipcMain.handle('settings:load', () => loadSettings(settingsFile()))
  ipcMain.on('settings:save', (_event, data: unknown) => storeSettings(data))
  ipcMain.on('player:state', (_event, data: unknown) => {
    const report = sanitizeReport(data)
    tray.report(report)
    thumbar?.report(report)
    mini.report(report)
  })
  ipcMain.on('mini:open', () => mini.open())
  ipcMain.on('mini:close', () => mini.close())
  ipcMain.on('mini:show-main', showWindow)
  ipcMain.handle('mini:state', () => mini.state())
  ipcMain.on('mini:key', (_event, key: unknown) => {
    if (isMiniKey(key)) sendMediaKey(key)
  })
  ipcMain.handle('favorites:load', () => loadFavorites(favoritesFile()))
  ipcMain.on('favorites:save', (_event, data: unknown) => storeFavorites(data))
  ipcMain.handle('history:load', () => loadHistory(historyFile()))
  ipcMain.on('history:save', (_event, data: unknown) => storeHistory(data))
  ipcMain.handle('app:data-folder', () => app.getPath('userData'))
  const updates = startUpdates((state) => {
    for (const open of BrowserWindow.getAllWindows()) open.webContents.send('update:state', state)
  })
  const fromMainWindow = (sender: WebContents): boolean => mainWindow !== null && sender === mainWindow.webContents
  ipcMain.on('browser:place', (event, bounds: unknown) => {
    const clean = sanitizeBounds(bounds)
    if (fromMainWindow(event.sender) && clean !== null) browser?.place(clean)
  })
  ipcMain.on('browser:hide', (event) => {
    if (fromMainWindow(event.sender)) browser?.hide()
  })
  ipcMain.on('browser:move', (event, move: unknown) => {
    if (!fromMainWindow(event.sender)) return
    if (move === 'back') browser?.back()
    else if (move === 'forward') browser?.forward()
    else if (move === 'reload') browser?.reload()
  })
  ipcMain.handle('browser:go', (event, text: unknown) => fromMainWindow(event.sender) && browser !== null && browser.go(typeof text === 'string' ? text : ''))
  ipcMain.on('video:command', (event, command: unknown) => {
    const clean = sanitizeVideoCommand(command)
    if (fromMainWindow(event.sender) && clean !== null) video?.command(clean)
  })
  ipcMain.handle('browser:state', () => browser?.state() ?? { url: '', canGoBack: false, canGoForward: false, loading: false })
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:state', () => updates.state())
  ipcMain.handle('update:check', () => updates.check())
  ipcMain.handle('update:download', () => updates.download())
  ipcMain.handle('update:install', () => updates.install())
  try {
    applyTraySetting((await loadSettings(settingsFile())).closeToTray)
  } catch (error) {
    console.error('Could not read the tray setting', error)
  }
  const window = createWindow()
  mainWindow = window
  // Only the app check may change the start page (and only in a development run, never in the installed program).
  const testHome = app.isPackaged ? undefined : process.env['BRITA_TEST_BROWSER_HOME']
  browser = createBrowserPane(window, {
    home: testHome ?? HOME_URL,
    onState: (state) => {
      if (!window.isDestroyed()) window.webContents.send('browser:state', state)
    },
  })
  video = createVideoRemote(() => browser?.contents() ?? null, (state) => {
    if (!window.isDestroyed()) window.webContents.send('video:state', state)
  })
  window.on('closed', () => video?.stop())
  // The music plays in the main window, so a mini player without it would show a song that is gone.
  window.on('closed', () => mini.close())
  thumbar = createThumbar(window, {
    previous: () => sendMediaKey('previous'),
    'play-pause': () => sendMediaKey('play-pause'),
    next: () => sendMediaKey('next'),
  })
  if (USE_GLOBAL_MEDIA_KEYS) registerMediaKeys(window)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  watcher.close()
})
app.on('window-all-closed', () => app.quit())
