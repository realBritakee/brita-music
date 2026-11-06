import { nativeImage, type BrowserWindow, type NativeImage, type ThumbarButton } from 'electron'
import { glyphBitmap } from './thumbGlyphs.ts'
import { thumbSignature, thumbSpecs, type Glyph, type ThumbAction } from './thumbModel.ts'
import { NO_SONG } from './trayMenu.ts'
import type { PlaybackReport } from '../shared/types.ts'

export interface ThumbarController {
  report(report: PlaybackReport): void
}

export type ThumbarActions = Record<ThumbAction, () => void>

/** One size per screen scaling: 100 percent, 150 percent and 200 percent. */
const SIZES: Array<[pixels: number, scaleFactor: number]> = [
  [16, 1],
  [24, 1.5],
  [32, 2],
]

const icons = new Map<Glyph, NativeImage>()

function iconFor(glyph: Glyph): NativeImage {
  const known = icons.get(glyph)
  if (known !== undefined) return known
  const [[firstSize, firstScale], ...more] = SIZES
  const image = nativeImage.createFromBitmap(glyphBitmap(glyph, firstSize), { width: firstSize, height: firstSize, scaleFactor: firstScale })
  for (const [pixels, scaleFactor] of more) {
    image.addRepresentation({ scaleFactor, width: pixels, height: pixels, buffer: glyphBitmap(glyph, pixels) })
  }
  icons.set(glyph, image)
  return image
}

/** Previous, play or pause, and next on the window's taskbar thumbnail (Windows only). */
export function createThumbar(window: BrowserWindow, actions: ThumbarActions): ThumbarController {
  let latest: PlaybackReport = NO_SONG
  let applied = ''

  const apply = (force: boolean): void => {
    if (window.isDestroyed()) return
    const specs = thumbSpecs(latest)
    const signature = thumbSignature(specs)
    if (!force && signature === applied) return
    // An enabled button has no flags: giving 'enabled' explicitly makes Windows refuse the call (tried on this PC).
    const buttons: ThumbarButton[] = specs.map((spec) => ({
      icon: iconFor(spec.glyph),
      tooltip: spec.tooltip,
      ...(spec.enabled ? {} : { flags: ['disabled'] }),
      click: () => actions[spec.action](),
    }))
    if (window.setThumbarButtons(buttons)) applied = signature
    else console.error('The taskbar thumbnail buttons could not be set.')
  }

  // The taskbar button is created when the window first shows, and again when it comes back from the tray.
  window.on('show', () => apply(true))
  apply(false)

  return {
    report(report) {
      latest = report
      apply(false)
    },
  }
}
