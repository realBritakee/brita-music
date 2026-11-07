import { session, WebContentsView, type BrowserWindow, type Session } from 'electron'
import { isAllowedAddress, resolveTypedAddress, type Bounds } from './browserModel.ts'
import type { BrowserState } from '../shared/types.ts'

export interface BrowserPane {
  /** Shows the view at this place in the window, and loads the home page the first time. */
  place(bounds: Bounds): void
  /** Hides the view. A playing video keeps playing; the player bar controls it. */
  hide(): void
  back(): void
  forward(): void
  reload(): void
  /** Opens a typed address (or searches YouTube for typed words). False when the text cannot be opened. */
  go(text: string): boolean
  state(): BrowserState
  isVisible(): boolean
  /** The view's page, for the app check. Null before the first show. */
  contents(): Electron.WebContents | null
}

export interface BrowserPaneOptions {
  home: string
  onState(state: BrowserState): void
}

const PARTITION = 'persist:youtube'

/** The view lives in its own session: no cookies or storage are shared with the app, and no permission is ever granted. */
function lockSession(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  // This page only browses. Downloads are done by the app itself, never by the page.
  ses.on('will-download', (event) => event.preventDefault())
}

/** A real browser view inside the main window. It starts on youtube.com and may open any web page, but nothing else. */
export function createBrowserPane(window: BrowserWindow, options: BrowserPaneOptions): BrowserPane {
  let view: WebContentsView | null = null
  let loading = false
  const allowed = (url: string): boolean => isAllowedAddress(url)

  function state(): BrowserState {
    if (view === null || view.webContents.isDestroyed()) return { url: '', canGoBack: false, canGoForward: false, loading: false }
    const history = view.webContents.navigationHistory
    return { url: view.webContents.getURL(), canGoBack: history.canGoBack(), canGoForward: history.canGoForward(), loading }
  }

  function publish(): void {
    options.onState(state())
  }

  function create(): WebContentsView {
    lockSession(session.fromPartition(PARTITION))
    const created = new WebContentsView({
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const contents = created.webContents
    // Only a main page may be opened here. Pop-ups that point to an allowed page open in the same view.
    contents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) void contents.loadURL(url)
      return { action: 'deny' }
    })
    const guard = (event: Electron.Event, url: string): void => {
      if (!allowed(url)) event.preventDefault()
    }
    contents.on('will-navigate', (details) => guard(details, details.url))
    contents.on('will-redirect', (details) => guard(details, details.url))
    contents.on('did-start-loading', () => { loading = true; publish() })
    contents.on('did-stop-loading', () => { loading = false; publish() })
    contents.on('did-navigate', publish)
    contents.on('did-navigate-in-page', publish)
    window.contentView.addChildView(created)
    window.once('closed', () => {
      if (!contents.isDestroyed()) contents.close()
    })
    void contents.loadURL(options.home).catch((error: unknown) => console.error('Could not open the start page of the browser view', error))
    return created
  }

  return {
    place(bounds) {
      if (view === null) view = create()
      view.setBounds(bounds)
      view.setVisible(true)
      publish()
    },
    hide() {
      if (view === null || view.webContents.isDestroyed()) return
      // A video keeps playing: the player bar controls it from every page.
      view.setVisible(false)
    },
    back() {
      if (view !== null && view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
    },
    forward() {
      if (view !== null && view.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
    },
    reload() {
      if (view !== null) view.webContents.reload()
    },
    go(text) {
      const address = resolveTypedAddress(text)
      if (address === null || view === null) return false
      view.webContents.loadURL(address).catch((error: unknown) => console.error('Could not open the typed address', error))
      return true
    },
    state,
    isVisible: () => view !== null && view.getVisible(),
    contents: () => (view === null || view.webContents.isDestroyed() ? null : view.webContents),
  }
}
