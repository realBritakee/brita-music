import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createUpdates, type Updates } from './updates.ts'
import type { UpdateState } from '../shared/types.ts'

/** The installed program waits a moment after start, so the window and the library come first. */
const FIRST_LOOK_AFTER_MS = 5000

/**
 * A test run (never the installed program) can look at a local folder instead of GitHub: set
 * BRITA_UPDATE_URL to a folder served over http that holds `latest.yml` and the installer.
 * The installed program ignores this and reads the GitHub entry that electron-builder wrote into it.
 */
function useTestFeed(): boolean {
  const url = process.env['BRITA_UPDATE_URL']
  if (app.isPackaged || url === undefined || url === '') return false
  const config = path.join(app.getPath('userData'), 'dev-app-update.yml')
  writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: brita-music-updater-test\n`)
  autoUpdater.forceDevUpdateConfig = true
  autoUpdater.updateConfigPath = config
  return true
}

/** Sets up the update check; `report` receives every new state. The first look runs by itself in the installed program. */
export function startUpdates(report: (state: UpdateState) => void): Updates {
  // Nothing may download or install without the person's click.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  const testFeed = useTestFeed()
  const updates = createUpdates(autoUpdater, report)
  if (app.isPackaged || testFeed) {
    setTimeout(() => void updates.checkQuietly(), testFeed ? 0 : FIRST_LOOK_AFTER_MS)
  }
  return updates
}
