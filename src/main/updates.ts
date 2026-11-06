import type { UpdateState } from '../shared/types.ts'

/** The part of electron-updater's `autoUpdater` that this module uses. A test can stand in for it. */
export interface UpdaterLike {
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown
  on(event: 'update-not-available', listener: () => void): unknown
  on(event: 'download-progress', listener: (info: { percent: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export const CHECK_FAILED = 'Brita Music could not look for updates. Check your internet connection and try again.'
export const NOT_INSTALLED = 'Updates are only checked in the installed program.'
export const DOWNLOAD_FAILED = 'The update could not be downloaded. Check your internet connection and try again.'

export interface Updates {
  state(): UpdateState
  /** The look at start: silent unless a newer version exists. */
  checkQuietly(): Promise<void>
  /** The look the person asked for: says "up to date" or why it failed. */
  check(): Promise<void>
  download(): Promise<void>
  install(): void
}

/**
 * Looks for a newer version, downloads it only when told to, and reports every change of state.
 * Nothing is downloaded or installed by itself.
 */
export function createUpdates(updater: UpdaterLike, report: (state: UpdateState) => void): Updates {
  let current: UpdateState = { kind: 'idle' }
  /** True while a check that the person started is running; only then are "up to date" and errors shown. */
  let asked = false

  const set = (next: UpdateState) => {
    current = next
    report(next)
  }
  const busy = () => current.kind === 'checking' || current.kind === 'downloading' || current.kind === 'ready'
  const versionOf = (): string => ('version' in current ? current.version : '')

  updater.on('update-available', (info) => set({ kind: 'available', version: info.version }))
  updater.on('update-not-available', () => set(asked ? { kind: 'none' } : { kind: 'idle' }))
  updater.on('download-progress', (info) => {
    if (current.kind !== 'downloading') return
    set({ kind: 'downloading', version: current.version, percent: Math.max(0, Math.min(100, Math.round(info.percent))) })
  })
  updater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
  updater.on('error', (error) => console.error('The updater reported a problem', error))

  async function look(person: boolean): Promise<void> {
    if (busy()) return
    asked = person
    // A version found earlier stays on offer while the look for a newer one runs.
    const before = current
    if (person) set({ kind: 'checking' })
    try {
      const result = await updater.checkForUpdates()
      // `null` means the updater is switched off, which is the case in a program that is not installed.
      if (result === null) set(person ? { kind: 'error', message: NOT_INSTALLED } : before)
    } catch (error) {
      console.error('Looking for updates failed', error)
      set(person ? { kind: 'error', message: CHECK_FAILED } : before.kind === 'available' ? before : { kind: 'idle' })
    } finally {
      asked = false
    }
  }

  return {
    state: () => current,
    checkQuietly: () => look(false),
    check: () => look(true),
    async download() {
      if (current.kind !== 'available') return
      const version = versionOf()
      set({ kind: 'downloading', version, percent: 0 })
      try {
        await updater.downloadUpdate()
      } catch (error) {
        console.error('Downloading the update failed', error)
        set({ kind: 'available', version, problem: DOWNLOAD_FAILED })
      }
    },
    install() {
      if (current.kind === 'ready') updater.quitAndInstall()
    },
  }
}
