import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { NO_SONG, trayEntries, trayTooltip, type TrayAction } from './trayMenu.ts'
import type { PlaybackReport } from '../shared/types.ts'

export interface TrayController {
  /** Shows or removes the tray icon. Returns whether the icon is there afterwards. */
  setEnabled(on: boolean): boolean
  /** True while the icon is really in the tray, so closing the window may hide it instead of quitting. */
  isActive(): boolean
  report(report: PlaybackReport): void
}

export interface TrayActions {
  open(): void
  mini(): void
  playPause(): void
  next(): void
  quit(): void
}

/** The tray icon and its menu. The icon exists only while the person chose to keep playing in the tray. */
export function createTrayController(iconPath: string, actions: TrayActions): TrayController {
  let tray: Tray | null = null
  let latest: PlaybackReport = NO_SONG

  const run = (action: TrayAction | null): void => {
    if (action === 'open') actions.open()
    else if (action === 'mini') actions.mini()
    else if (action === 'play-pause') actions.playPause()
    else if (action === 'next') actions.next()
    else if (action === 'quit') actions.quit()
  }

  const refresh = (): void => {
    if (tray === null) return
    const template: MenuItemConstructorOptions[] = trayEntries(latest).map((entry) =>
      entry.kind === 'separator'
        ? { type: 'separator' }
        : { label: entry.label, enabled: entry.enabled, click: () => run(entry.action) },
    )
    tray.setContextMenu(Menu.buildFromTemplate(template))
    tray.setToolTip(trayTooltip(latest))
  }

  const create = (): boolean => {
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      // An invisible icon would leave the program running with no way back, so there is no icon and no tray mode.
      console.error(`The tray icon could not be loaded from ${iconPath}.`)
      return false
    }
    tray = new Tray(image)
    tray.on('click', () => actions.open())
    refresh()
    return true
  }

  return {
    setEnabled(on) {
      if (on && tray === null) return create()
      if (!on && tray !== null) {
        tray.destroy()
        tray = null
      }
      return tray !== null
    },
    isActive: () => tray !== null && !tray.isDestroyed(),
    report(report) {
      latest = report
      refresh()
    },
  }
}
