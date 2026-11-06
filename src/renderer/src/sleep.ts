/** The sleep timer: stop after a number of minutes, or after the song that is playing. Not saved; a restart clears it. */
export type SleepTimer = { kind: 'off' } | { kind: 'time'; endsAt: number } | { kind: 'song' }

export const SLEEP_OFF: SleepTimer = { kind: 'off' }

/** The time choices of the menu, in minutes. */
export const SLEEP_MINUTES = [15, 30, 60] as const

/** The sound fades out over this long before playback stops. */
export const FADE_SECONDS = 3

export function sleepAfter(minutes: number, now: number): { kind: 'time'; endsAt: number } {
  return { kind: 'time', endsAt: now + minutes * 60_000 }
}

/** Whole seconds until the timer ends (rounded up, never below zero). */
export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(Math.ceil((endsAt - now) / 1000), 0)
}

/** "14:32", or "1:00:00" from one hour up. */
export function formatLeft(seconds: number): string {
  const whole = Math.max(Math.floor(seconds), 0)
  const hours = Math.floor(whole / 3600)
  const minutes = String(Math.floor((whole % 3600) / 60)).padStart(hours > 0 ? 2 : 1, '0')
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`
}

/** How loud the fade still is: 1 at the start, 0 when `fadeSeconds` have passed. */
export function fadeFactor(elapsedMs: number, fadeSeconds: number = FADE_SECONDS): number {
  return Math.min(Math.max(1 - elapsedMs / (fadeSeconds * 1000), 0), 1)
}

/** What the button in the player bar shows: the time left, or "Song end". Empty when no timer runs. */
export function sleepLabel(timer: SleepTimer, left: number): string {
  if (timer.kind === 'time') return formatLeft(left)
  return timer.kind === 'song' ? 'Song end' : ''
}

/** The tooltip and screen reader text of the button. */
export function sleepTitle(timer: SleepTimer, left: number): string {
  if (timer.kind === 'time') return `Sleep timer: stops in ${formatLeft(left)}`
  return timer.kind === 'song' ? 'Sleep timer: stops after this song' : 'Sleep timer'
}
