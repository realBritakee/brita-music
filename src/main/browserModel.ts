// Rules for the Download page's browser view. Plain functions, so they can be tested without Electron.

export const HOME_URL = 'https://www.youtube.com/'

/** Pages the view may open as a main page: YouTube, its short links, and Google's sign-in and consent pages. */
const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'accounts.google.com', 'consent.google.com']

/** A rectangle in window coordinates, in whole pixels. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const MAX_SIZE = 20000

/**
 * True when the view may show this address. Only https and only the hosts above (and their subdomains) pass.
 * `testHosts` are extra hosts for the app check; they may use plain http. The app passes none in a real run.
 */
export function isAllowedAddress(raw: unknown, testHosts: readonly string[] = []): boolean {
  if (typeof raw !== 'string') return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase()
  if (testHosts.includes(host)) return url.protocol === 'http:' || url.protocol === 'https:'
  if (url.protocol !== 'https:' || url.port !== '') return false
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
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
