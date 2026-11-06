import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'

export interface WatchOptions {
  /** How long the folders must stay quiet before the change is reported. A big copy is reported once. */
  quietMs?: number
  /** The longest a change waits, even if the folders never go quiet. */
  maxWaitMs?: number
  /** How often it looks whether a missing folder is back, or a watched one has gone. */
  checkEveryMs?: number
}

export interface FolderWatcher {
  /** Sets the folders to watch. Folders that are not there are looked for again every few seconds. */
  sync(folders: string[]): void
  close(): void
}

async function isFolder(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Calls `onChange` when something inside the folders changes, when a missing folder comes back and
 * when a watched folder disappears (for example an unplugged drive). Changes that come in a burst
 * are reported once.
 */
export function createWatcher(onChange: () => void, options: WatchOptions = {}): FolderWatcher {
  const quietMs = options.quietMs ?? 800
  const maxWaitMs = options.maxWaitMs ?? 5000
  const checkEveryMs = options.checkEveryMs ?? 3000

  const watchers = new Map<string, FSWatcher>()
  let folders: string[] = []
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  let waitTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const key = (folder: string) => folder.toLowerCase()

  function fire(): void {
    clearTimeout(quietTimer)
    clearTimeout(waitTimer)
    quietTimer = undefined
    waitTimer = undefined
    if (!closed) onChange()
  }

  function changed(): void {
    clearTimeout(quietTimer)
    quietTimer = setTimeout(fire, quietMs)
    waitTimer ??= setTimeout(fire, maxWaitMs)
  }

  function detach(folder: string): void {
    const watcher = watchers.get(key(folder))
    if (watcher === undefined) return
    watchers.delete(key(folder))
    watcher.close()
  }

  /** Starts watching one folder. False if that is not possible right now. */
  function attach(folder: string): boolean {
    try {
      const watcher = watch(folder, { recursive: true }, changed)
      watcher.on('error', () => {
        detach(folder)
        changed()
      })
      watchers.set(key(folder), watcher)
      return true
    } catch {
      return false
    }
  }

  async function look(): Promise<void> {
    for (const folder of folders) {
      const there = await isFolder(folder)
      const watched = watchers.has(key(folder))
      if (there && !watched) {
        if (attach(folder)) changed()
      } else if (!there && watched) {
        detach(folder)
        changed()
      }
    }
  }

  const timer = setInterval(() => void look(), checkEveryMs)
  timer.unref()

  return {
    sync(next) {
      folders = next
      const wanted = new Set(next.map(key))
      for (const name of [...watchers.keys()]) {
        if (!wanted.has(name)) detach(name)
      }
      for (const folder of next) {
        if (!watchers.has(key(folder))) attach(folder)
      }
    },
    close() {
      closed = true
      clearInterval(timer)
      clearTimeout(quietTimer)
      clearTimeout(waitTimer)
      for (const name of [...watchers.keys()]) detach(name)
    },
  }
}
