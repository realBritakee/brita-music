// Rules for the Download page's browser view. Plain functions, so they can be tested without Electron.

export const HOME_URL = 'https://www.youtube.com/'

/** A rectangle in window coordinates, in whole pixels. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const MAX_SIZE = 20000

/**
 * True when the view may show this address: any web page (http or https). Files on the PC, scripts and the
 * app's own addresses are refused, so a web page can never lead the view to them.
 */
export function isAllowedAddress(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const HOST_AND_PORT = /^[^\s/:]+:\d+(\/|$)/
const LOOKS_LIKE_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^\s/]+\.[^\s/]+)(:\d+)?([/?#].*)?$/i

/**
 * What the address bar does with typed text. A web address opens as it is (https is added when missing); anything
 * else is searched on YouTube. Null when the text is empty or points to something that is not a web page.
 */
export function resolveTypedAddress(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const typed = text.trim()
  if (typed === '') return null
  if (HAS_SCHEME.test(typed) && !HOST_AND_PORT.test(typed)) return isAllowedAddress(typed) ? new URL(typed).href : null
  if (!/\s/.test(typed) && LOOKS_LIKE_HOST.test(typed)) {
    const candidate = `https://${typed}`
    return isAllowedAddress(candidate) ? new URL(candidate).href : null
  }
  return `${HOME_URL}results?search_query=${encodeURIComponent(typed)}`
}

/** Reads a rectangle from the screen's message; null when it is not usable. */
export function sanitizeBounds(value: unknown): Bounds | null {
  if (typeof value !== 'object' || value === null) return null
  const { x, y, width, height } = value as Record<string, unknown>
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [px, py, pw, ph] = (numbers as number[]).map((n) => Math.round(n))
  if (px < 0 || py < 0 || pw <= 0 || ph <= 0 || pw > MAX_SIZE || ph > MAX_SIZE) return null
  return { x: px, y: py, width: pw, height: ph }
}
