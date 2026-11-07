import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserState } from '../../shared/types'

const NOT_STARTED: BrowserState = { url: '', canGoBack: false, canGoForward: false, loading: false }

/**
 * The Download page: a toolbar and an empty box. The real browser view (youtube.com) is a separate native view
 * that the main window lays over the box, so this page tells it where the box is and hides it when the page closes.
 */
export function DownloadPage() {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState>(NOT_STARTED)

  useEffect(() => {
    const element = box.current
    if (element === null) return undefined
    const place = () => {
      const rect = element.getBoundingClientRect()
      window.brita.placeBrowser({ x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.brita.hideBrowser()
    }
  }, [])

  useEffect(() => {
    let alive = true
    window.brita.browserState().then((now) => { if (alive) setState(now) }).catch((error: unknown) => console.error('Could not read the browser state', error))
    const stop = window.brita.onBrowser(setState)
    return () => {
      alive = false
      stop()
    }
  }, [])

  return (
    <section className="browse" aria-label="Download">
      <div className="browse-bar">
        <button type="button" className="browse-btn" aria-label="Back" title="Back" disabled={!state.canGoBack} onClick={() => window.brita.moveBrowser('back')}>
          <ArrowLeft className="i" aria-hidden />
        </button>
        <button type="button" className="browse-btn" aria-label="Forward" title="Forward" disabled={!state.canGoForward} onClick={() => window.brita.moveBrowser('forward')}>
          <ArrowRight className="i" aria-hidden />
        </button>
        <button type="button" className="browse-btn" aria-label="Reload" title="Reload" onClick={() => window.brita.moveBrowser('reload')}>
          <RotateCw className={`i${state.loading ? ' spin' : ''}`} aria-hidden />
        </button>
        <input className="browse-address" readOnly aria-label="Address" value={state.url} placeholder="Opening youtube.com" />
      </div>
      <div className="browse-box" ref={box} />
    </section>
  )
}
