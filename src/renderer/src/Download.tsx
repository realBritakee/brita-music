import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BrowserState } from '../../shared/types'

const NOT_STARTED: BrowserState = { url: '', canGoBack: false, canGoForward: false, loading: false }

/**
 * The Download page: a toolbar and an empty box. The real browser view (youtube.com) is a separate native view
 * that the main window lays over the box, so this page tells it where the box is and hides it when the page closes.
 */
export function DownloadPage() {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState>(NOT_STARTED)
  // What the person is typing; null while the bar just shows the page the view is on.
  const [typed, setTyped] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)

  const open = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = typed ?? state.url
    window.brita.goBrowser(text).then((ok) => {
      setRefused(!ok)
      if (ok) setTyped(null)
    }).catch((error: unknown) => console.error('Could not open the address', error))
  }

  // A new page replaces what was typed: the bar shows the page the view is on.
  useEffect(() => {
    setTyped(null)
    setRefused(false)
  }, [state.url])

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
        <form className="browse-form" onSubmit={open}>
          <input
            className="browse-address"
            type="text"
            aria-label="Address"
            aria-invalid={refused ? 'true' : undefined}
            value={typed ?? state.url}
            placeholder="Type a web address or words to search on YouTube"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => { setTyped(event.target.value); setRefused(false) }}
            onBlur={() => { setTyped(null); setRefused(false) }}
          />
        </form>
      </div>
      {refused && <p className="message warn" role="alert">That is not a web address. Use one that starts with http or https, or just type a name.</p>}
      <div className="browse-box" ref={box} />
    </section>
  )
}
