import type { WebContents } from 'electron'
import type { VideoCommand, VideoState } from '../shared/types.ts'
import { commandScript, parseVideoState, READ_VIDEO } from './videoModel.ts'

export interface VideoRemote {
  /** Carries out a command in the video's page. */
  command(command: VideoCommand): void
  /** The last state that was reported, or null when there is no video. */
  state(): VideoState | null
  stop(): void
}

const POLL_MS = 500

/**
 * Watches the video in the browser view and reports it to the window whenever it changes (about twice a second while it
 * plays). The reports are told "no video" once when the page has none, so the player bar can go back to the music.
 */
export function createVideoRemote(contents: () => WebContents | null, report: (state: VideoState | null) => void): VideoRemote {
  let last: VideoState | null = null
  let lastText = 'null'
  let busy = false

  function publish(state: VideoState | null): void {
    const text = JSON.stringify(state)
    if (text === lastText) return
    lastText = text
    last = state
    report(state)
  }

  async function poll(): Promise<void> {
    if (busy) return
    busy = true
    try {
      const page = contents()
      if (page === null || page.isDestroyed() || page.isLoading()) {
        if (page === null || page.isDestroyed()) publish(null)
        return
      }
      publish(parseVideoState(await page.executeJavaScript(READ_VIDEO)))
    } catch (error) {
      // A page that changes while it is read is normal; "no video" is the safe answer.
      publish(null)
      console.error('Could not read the video', error)
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => void poll(), POLL_MS)

  return {
    command(command) {
      const page = contents()
      if (page === null || page.isDestroyed()) return
      page.executeJavaScript(commandScript(command)).then(() => poll()).catch((error: unknown) => console.error('Could not control the video', error))
    },
    state: () => last,
    stop: () => clearInterval(timer),
  }
}
