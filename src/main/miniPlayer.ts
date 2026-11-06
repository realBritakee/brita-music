import { BrowserWindow, screen } from 'electron'
import { defaultMiniPosition, loadMiniPosition, MINI_SIZE, saveMiniPosition } from './miniModel.ts'
import { NO_SONG } from './trayMenu.ts'
import type { PlaybackReport } from '../shared/types.ts'

export interface MiniPlayerController {
  /** Opens the mini player, or brings it forward if it is open. */
  open(): void
  close(): void
  isOpen(): boolean
  report(report: PlaybackReport): void
  /** What the player last reported. */
  state(): PlaybackReport
}

export interface MiniPlayerOptions {
  preload: string
  /** Where the position is remembered. */
  positionFile(): string
  /** Loads the mini player's page into the window. */
  load(window: BrowserWindow): void
  /** The main window, so the mini player opens on the same screen. */
  anchor(): BrowserWindow | null
}

const SAVE_AFTER_MS = 400

/** The small always-on-top player. It shows what the main window reports; the main window does the playing. */
export function createMiniPlayer(options: MiniPlayerOptions): MiniPlayerController {
  let window: BrowserWindow | null = null
  let latest: PlaybackReport = NO_SONG

  const workAreas = () => screen.getAllDisplays().map((display) => display.workArea)

  const startPosition = () => {
    try {
      const saved = loadMiniPosition(options.positionFile(), workAreas())
      if (saved !== null) return saved
    } catch (error) {
      console.error('Could not read the mini player position', error)
    }
    const anchor = options.anchor()
    const display = anchor !== null && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay()
    return defaultMiniPosition(display.workArea)
  }

  const rememberPosition = (mini: BrowserWindow): void => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(timer)
      if (mini.isDestroyed()) return
      const { x, y } = mini.getBounds()
      try {
        saveMiniPosition(options.positionFile(), { x, y })
      } catch (error) {
        console.error('Could not save the mini player position', error)
      }
    }
    mini.on('move', () => {
      clearTimeout(timer)
      timer = setTimeout(save, SAVE_AFTER_MS)
    })
    mini.on('close', save)
  }

  const create = (): BrowserWindow => {
    const { x, y } = startPosition()
    const mini = new BrowserWindow({
      ...MINI_SIZE,
      x,
      y,
      useContentSize: true,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#202020',
      title: 'Brita Music mini player',
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mini.webContents.on('will-navigate', (event) => event.preventDefault())
    rememberPosition(mini)
    // It appears without taking the keyboard focus away from whatever the person is doing.
    mini.once('ready-to-show', () => { if (!mini.isDestroyed()) mini.showInactive() })
    mini.on('closed', () => { if (window === mini) window = null })
    options.load(mini)
    return mini
  }

  const isOpen = () => window !== null && !window.isDestroyed()

  return {
    open() {
      if (!isOpen()) {
        window = create()
        return
      }
      if (window !== null) window.showInactive()
    },
    close() {
      if (window !== null && !window.isDestroyed()) window.close()
    },
    isOpen,
    report(report) {
      latest = report
      if (window !== null && !window.isDestroyed()) window.webContents.send('mini:state', report)
    },
    state: () => latest,
  }
}
