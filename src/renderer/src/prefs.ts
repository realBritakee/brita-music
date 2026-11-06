import type { RepeatAtStart, RepeatMode, ShuffleAtStart } from '../../shared/types'

/** Shuffle when the app starts: what it was last time, or the fixed choice. */
export function shuffleAtStart(choice: ShuffleAtStart, remembered: boolean): boolean {
  return choice === 'remember' ? remembered : choice === 'on'
}

/** Repeat when the app starts: what it was last time, or the fixed choice. */
export function repeatAtStart(choice: RepeatAtStart, remembered: RepeatMode): RepeatMode {
  return choice === 'remember' ? remembered : choice
}

/** "Previous" restarts the song only after it has played longer than `restartAfter` seconds; 0 means it never does. */
export function restartsSong(position: number, restartAfter: number): boolean {
  return restartAfter > 0 && position > restartAfter
}
