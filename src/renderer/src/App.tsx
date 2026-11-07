import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowDown, ArrowUp, ArrowUpToLine, Check, Copy, Disc3, Download as DownloadIcon, FolderOpen, FolderPlus, Heart, History, Library as LibraryIcon, ListEnd, ListMusic, ListOrdered, ListPlus, Music,
  Moon, Pause, PictureInPicture2, Play, RefreshCw, Repeat, Repeat1, Search, Settings as SettingsIcon, Shuffle, SkipBack, SkipForward, Speaker, User, Volume1, Volume2,
  TrendingUp, VolumeX, X, type LucideIcon,
} from 'lucide-react'
import type { Song } from '../../shared/types'
import { FAVORITES_VIEW } from './favorites'
import { MOST_VIEW, RECENT_VIEW } from './history'
import { folderLabels } from './queue'
import type { SortKey } from './search'
import { SLEEP_MINUTES, sleepLabel, sleepTitle } from './sleep'
import { DownloadPage } from './Download'
import { AddFolderButton, SettingsPage, UpdateActions, updateText } from './Settings'
import { songsInView, useMusic, visibleSongs } from './store'
import { formatTime } from './time'

const SEARCH_ID = 'song-search'

/** The lists the app makes by itself, in the order of the sidebar: their view key, name, icon and the text of an empty list. */
const AUTOMATIC_LISTS: Array<{ view: string; title: string; Icon: LucideIcon; empty: string }> = [
  { view: FAVORITES_VIEW, title: 'Favorites', Icon: Heart, empty: 'No favorites yet. Click the heart next to a song to add it here.' },
  { view: RECENT_VIEW, title: 'Recently played', Icon: History, empty: 'Nothing played yet. Songs you listen to appear here.' },
  { view: MOST_VIEW, title: 'Most played', Icon: TrendingUp, empty: 'Nothing played yet. Your most played songs appear here.' },
]

/** The space bar plays and pauses, except while typing in a text field. */
function useSpaceBar(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target
      const typing = target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox'))
      if (typing) return
      // On the settings page and in a menu the space bar keeps its normal job (pressing the focused button).
      if (target instanceof HTMLElement && target.closest('.settings, .ctx-menu, .out-menu') !== null) return
      // Stops a focused button (such as the song just clicked) from also reacting to the space bar.
      event.preventDefault()
      useMusic.getState().togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Ctrl+F jumps to the search box. */
function useSearchShortcut(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return
      const box = document.getElementById(SEARCH_ID)
      if (box === null) return
      event.preventDefault()
      box.focus()
      if (box instanceof HTMLInputElement) box.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Tells the person that a new version exists, or how its download goes. "Later" hides it until the next start. */
function UpdateBanner() {
  const update = useMusic((state) => state.update)
  const later = useMusic((state) => state.laterVersion)
  const postponeUpdate = useMusic((state) => state.postponeUpdate)
  const page = useMusic((state) => state.page)
  const show = update.kind === 'available' || update.kind === 'downloading' || update.kind === 'ready'
  if (!show || update.version === later || page !== 'library') return null
  return (
    <div className="update-bar" role="status">
      <div className="update-bar-text">
        <span>{updateText(update)}</span>
        {update.kind === 'available' && update.problem !== undefined && <span className="update-problem" role="alert">{update.problem}</span>}
        {update.kind === 'downloading' && <progress className="update-progress" max={100} value={update.percent} aria-label="Download progress" />}
      </div>
      <UpdateActions small />
      {update.kind !== 'downloading' && (
        <button type="button" className="btn btn-secondary btn-small" onClick={postponeUpdate}>Later</button>
      )}
    </div>
  )
}

const DRAG_QUIET_MS = 1000

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

/**
 * Takes files and folders dropped anywhere on the window. Without this the window would open the dropped file
 * itself and leave the app. Returns true while something is being dragged over the window.
 * A drop on a playlist is handled by that playlist (see `Sidebar`), so it never reaches this handler.
 */
function useFileDrag(): boolean {
  const dropFiles = useMusic((state) => state.dropFiles)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter and dragleave fire for every element on the way, so they are counted.
    let depth = 0
    let quiet: ReturnType<typeof setTimeout> | undefined
    // While a drag is over the window, dragover keeps arriving. If it stops, the drag was cancelled or left the window.
    const stillDragging = () => {
      clearTimeout(quiet)
      quiet = setTimeout(() => {
        depth = 0
        setDragging(false)
      }, DRAG_QUIET_MS)
    }
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth++
      setDragging(true)
      stillDragging()
    }
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
      stillDragging()
    }
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      clearTimeout(quiet)
      setDragging(false)
      // A drop on a playlist is handled by that playlist.
      if (event.target instanceof Element && event.target.closest('[data-drop-playlist]') !== null) return
      void dropFiles([...(event.dataTransfer?.files ?? [])], null)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      clearTimeout(quiet)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [dropFiles])

  return dragging
}

export function App() {
  useSpaceBar()
  useSearchShortcut()
  const hasFolder = useMusic((state) => state.library.folders.length > 0)
  const loading = useMusic((state) => state.loading)
  const page = useMusic((state) => state.page)
  const queueOpen = useMusic((state) => state.queueOpen)
  const dragging = useFileDrag()
  return (
    <div className={`app${queueOpen ? ' with-queue' : ''}`}>
      <Sidebar dragging={dragging} />
      <main className="main">
        {dragging && (
          <div className="drop-hint" role="status">
            <FolderPlus className="i" aria-hidden />
            <strong>Drop a folder to add it as a music folder</strong>
            <span>To copy songs into a playlist, drop them onto that playlist in the sidebar.</span>
          </div>
        )}
        <UpdateBanner />
        {page === 'settings' && <SettingsPage />}
        {page === 'download' && <DownloadPage />}
        {page === 'library' && (hasFolder || loading ? <SongList /> : <FirstStart />)}
      </main>
      {queueOpen && <QueuePanel />}
      <PlayerBar />
    </div>
  )
}

/** The cover of a song. The picture is asked for only when the row is near the screen; no picture shows a note. */
function Cover({ song, className }: { song: Song; className: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <span className={className}>
      {missing ? (
        <Music className="i" aria-hidden />
      ) : (
        <img src={window.brita.coverUrl(song.path)} alt="" loading="lazy" onError={() => setMissing(true)} />
      )}
    </span>
  )
}

/** "“Musik” cannot be found." or "“Musik”, “Other” cannot be found." */
function missingText(folders: string[]): string {
  const labels = folderLabels(folders).map((label) => `“${label}”`).join(', ')
  return `${labels} cannot be found.`
}

/** The heart of a song: filled when the song is a favorite. A click gives or takes the heart. */
function HeartButton({ path, title, className, label }: { path: string; title: string; className: string; label: string }) {
  const favorite = useMusic((state) => state.favorites.includes(path))
  const toggleFavorite = useMusic((state) => state.toggleFavorite)
  return (
    <button
      type="button"
      className={`${className}${favorite ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={favorite}
      title={favorite ? `Remove “${title}” from your favorites` : `Add “${title}” to your favorites`}
      onClick={() => toggleFavorite(path)}
    >
      <Heart className="i" fill={favorite ? 'currentColor' : 'none'} aria-hidden />
    </button>
  )
}

/** "Playing next": the songs in the order they will play, also when shuffled. */
function QueuePanel() {
  const upcoming = useMusic((state) => state.upcoming)
  const count = useMusic((state) => state.upcomingCount)
  const current = useMusic((state) => state.current)
  const shuffle = useMusic((state) => state.shuffle)
  const playNext = useMusic((state) => state.playNext)
  const removeFromQueue = useMusic((state) => state.removeFromQueue)
  const toggleQueue = useMusic((state) => state.toggleQueue)

  const hidden = count - upcoming.length
  return (
    <aside className="queue" aria-label="Playing next">
      <header className="queue-head">
        <div className="queue-title">
          <h2>Playing next</h2>
          <p className="muted">{current === null ? 'Nothing is playing' : `${count === 1 ? '1 song' : `${count} songs`}${shuffle ? ', shuffled' : ''}`}</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close the queue" title="Close the queue" onClick={toggleQueue}>
          <X className="i" aria-hidden />
        </button>
      </header>
      {upcoming.length === 0 ? (
        <p className="queue-empty muted">{current === null ? 'Pick a song to see what plays after it.' : 'No song is left after this one.'}</p>
      ) : (
        <ol className="queue-list">
          {upcoming.map((song, index) => (
            <li key={song.path} className="queue-row">
              <Cover song={song} className="thumb" />
              <span className="queue-text">
                <span className="queue-song">{song.title}</span>
                {song.artist !== '' && <span className="queue-artist">{song.artist}</span>}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Play ${song.title} next`}
                title="Play next"
                disabled={index === 0}
                onClick={() => playNext(song.path)}
              >
                <ArrowUpToLine className="i" aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${song.title} from the queue`}
                title="Remove from the queue"
                onClick={() => removeFromQueue(song.path)}
              >
                <X className="i" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      {hidden > 0 && <p className="queue-more muted">and {hidden} more</p>}
    </aside>
  )
}

function lengthOf(song: Song): string {
  return song.duration === null ? '' : formatTime(song.duration)
}

/** Where the song menu is open: which song, where on the screen, and the row to give the focus back to. */
interface MenuTarget {
  song: Song
  x: number
  y: number
  opener: HTMLElement
}

interface MenuItem {
  label: string
  icon: LucideIcon
  run(): void
  /** Why the entry cannot be used right now. */
  disabled?: string
}

const MENU_EDGE = 8

/** The right-click menu of a song row. */
function SongMenu({ target, onClose }: { target: MenuTarget; onClose: (restoreFocus: boolean) => void }) {
  const { song } = target
  const currentPath = useMusic((state) => state.current?.path ?? null)
  const playNext = useMusic((state) => state.playNext)
  const addToQueue = useMusic((state) => state.addToQueue)
  const revealSong = useMusic((state) => state.revealSong)
  const copyPath = useMusic((state) => state.copyPath)
  const goTo = useMusic((state) => state.goTo)
  const isFavorite = useMusic((state) => state.favorites.includes(song.path))
  const toggleFavorite = useMusic((state) => state.toggleFavorite)
  const menu = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ left: target.x, top: target.y })

  const queueReason = currentPath === null ? 'Start a song first' : currentPath === song.path ? 'This song is playing now' : undefined
  const groups: MenuItem[][] = [
    [
      { label: 'Play next', icon: ArrowUpToLine, run: () => playNext(song.path), disabled: queueReason },
      { label: 'Add to queue', icon: ListEnd, run: () => addToQueue(song.path), disabled: queueReason },
    ],
    [
      { label: 'Show in Explorer', icon: FolderOpen, run: () => void revealSong(song.path) },
      { label: 'Copy path', icon: Copy, run: () => void copyPath(song.path) },
    ],
    [
      { label: 'Go to artist', icon: User, run: () => goTo(song.artist), disabled: song.artist === '' ? 'This song has no artist' : undefined },
      { label: 'Go to album', icon: Disc3, run: () => goTo(song.album), disabled: song.album === '' ? 'This song has no album' : undefined },
    ],
    [
      { label: isFavorite ? 'Remove from favorites' : 'Add to favorites', icon: Heart, run: () => toggleFavorite(song.path) },
    ],
  ]

  const enabledItems = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]

  // Keeps the menu on screen, then puts the focus on its first entry.
  useLayoutEffect(() => {
    const box = menu.current
    if (box === null) return
    const left = Math.max(MENU_EDGE, Math.min(target.x, window.innerWidth - box.offsetWidth - MENU_EDGE))
    const top = Math.max(MENU_EDGE, Math.min(target.y, window.innerHeight - box.offsetHeight - MENU_EDGE))
    setPlace({ left, top })
    enabledItems()[0]?.focus()
  }, [target])

  // Anything outside the menu closes it: a click, a scroll, a resized or deactivated window.
  useEffect(() => {
    const away = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      onClose(false)
    }
    const closeAlways = () => onClose(false)
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('wheel', away, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', closeAlways)
    window.addEventListener('blur', closeAlways)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('wheel', away, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', closeAlways)
      window.removeEventListener('blur', closeAlways)
    }
  }, [onClose])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const items = enabledItems()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number) => { event.preventDefault(); items[(index + items.length) % items.length]?.focus() }
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at === -1 ? -1 : at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(-1)
    else if (event.key === 'Escape') { event.preventDefault(); onClose(true) }
    else if (event.key === 'Tab') { event.preventDefault(); onClose(true) }
  }

  return (
    <div
      ref={menu}
      className="ctx-menu"
      role="menu"
      aria-label={`Actions for ${song.title}`}
      style={{ left: place.left, top: place.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {groups.map((group, index) => (
        <div key={index} className="ctx-group" role="group">
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="ctx-item"
              disabled={item.disabled !== undefined}
              title={item.disabled}
              onClick={() => { item.run(); onClose(true) }}
            >
              <item.icon className="i" aria-hidden />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function Sidebar({ dragging }: { dragging: boolean }) {
  const dropFiles = useMusic((state) => state.dropFiles)
  /** The playlist a file is being dragged over right now. */
  const [dropKey, setDropKey] = useState<string | null>(null)
  useEffect(() => {
    if (!dragging) setDropKey(null)
  }, [dragging])
  const library = useMusic((state) => state.library)
  const view = useMusic((state) => state.view)
  const setView = useMusic((state) => state.setView)
  const page = useMusic((state) => state.page)
  const setPage = useMusic((state) => state.setPage)
  const inLibrary = page === 'library'
  const inSettings = page === 'settings'
  const inDownload = page === 'download'

  return (
    <aside className="side">
      <div className="brand">
        <span className="brand-mark"><Music className="i" aria-hidden /></span>
        Brita Music
      </div>
      <nav className="side-scroll" aria-label="Library">
        <button type="button" className={`s-item${inLibrary && view === 'all' ? ' on' : ''}`} onClick={() => setView('all')}>
          <LibraryIcon className="i" aria-hidden />
          <span className="s-name">All songs</span>
        </button>
        {AUTOMATIC_LISTS.map(({ view: key, title, Icon }) => (
          <button type="button" key={key} className={`s-item${inLibrary && view === key ? ' on' : ''}`} onClick={() => setView(key)}>
            <Icon className="i" aria-hidden />
            <span className="s-name">{title}</span>
          </button>
        ))}
        <div className="s-group">Playlists</div>
        <NewPlaylist />
        {library.playlists.length === 0 && <p className="s-empty">Folders inside your music folder appear here.</p>}
        {library.playlists.map((playlist) => (
          <button
            type="button"
            key={playlist.key}
            className={`s-item${inLibrary && view === playlist.key ? ' on' : ''}${dragging && dropKey === playlist.key ? ' drop-on' : ''}${dragging ? ' can-drop' : ''}`}
            onClick={() => setView(playlist.key)}
            data-drop-playlist={playlist.key}
            onDragOver={(event) => {
              if (!carriesFiles(event.nativeEvent)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              setDropKey(playlist.key)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropKey(null)
            }}
            onDrop={(event) => {
              if (!carriesFiles(event.nativeEvent)) return
              event.preventDefault()
              setDropKey(null)
              void dropFiles([...event.dataTransfer.files], playlist.key)
            }}
          >
            <ListMusic className="i" aria-hidden />
            <span className="s-name">{playlist.name}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <button
          type="button"
          className={`s-link${inDownload ? ' on' : ''}`}
          aria-current={inDownload ? 'page' : undefined}
          onClick={() => setPage(inDownload ? 'library' : 'download')}
        >
          <DownloadIcon className="i" aria-hidden />
          <span className="s-name">Download</span>
        </button>
        <button
          type="button"
          className={`s-link${inSettings ? ' on' : ''}`}
          aria-current={inSettings ? 'page' : undefined}
          onClick={() => setPage(inSettings ? 'library' : 'settings')}
        >
          <SettingsIcon className="i" aria-hidden />
          <span className="s-name">Settings</span>
        </button>
      </div>
    </aside>
  )
}

/** "New playlist" opens a small form; creating it makes a real, empty folder inside a music folder. */
function NewPlaylist() {
  const folders = useMusic((state) => state.library.folders)
  const missing = useMusic((state) => state.library.missing)
  const createPlaylist = useMusic((state) => state.createPlaylist)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const usable = folders.filter((folder) => !missing.includes(folder))
  const labels = folderLabels(usable)
  const chosen = usable.includes(target) ? target : (usable[0] ?? '')

  const close = () => {
    setOpen(false)
    setName('')
    setMessage(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const result = await createPlaylist(chosen, name)
    setBusy(false)
    if (result.ok) close()
    else setMessage(result.message)
  }

  if (!open) {
    return (
      <button type="button" className="s-action" onClick={() => setOpen(true)} disabled={usable.length === 0}>
        <ListPlus className="i" aria-hidden />
        <span className="s-name">New playlist</span>
      </button>
    )
  }

  return (
    <form className="new-playlist" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === 'Escape') close() }}>
      {usable.length > 1 && (
        <div className="field">
          <label htmlFor="new-playlist-folder">Music folder</label>
          <select id="new-playlist-folder" value={chosen} onChange={(event) => setTarget(event.target.value)}>
            {usable.map((folder, index) => <option key={folder} value={folder}>{labels[index]}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="new-playlist-name">Playlist name</label>
        <input
          id="new-playlist-name"
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          value={name}
          aria-invalid={message !== null}
          aria-describedby={message === null ? undefined : 'new-playlist-error'}
          onChange={(event) => { setName(event.target.value); setMessage(null) }}
        />
      </div>
      {message !== null && <p id="new-playlist-error" className="field-error" role="alert">{message}</p>}
      <div className="folder-buttons">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>Create</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={close}>Cancel</button>
      </div>
    </form>
  )
}

function FirstStart() {
  const libraryError = useMusic((state) => state.libraryError)
  return (
    <div className="first-start">
      <span className="first-mark"><Music className="i" aria-hidden /></span>
      <h1>Add your music folder</h1>
      <p className="muted first-lead">Pick the folder where your songs are. Brita Music only reads it, your files stay as they are.</p>
      <ul className="first-steps">
        <li><ListMusic className="i" aria-hidden /><span>Every folder inside it becomes a playlist.</span></li>
        <li><RefreshCw className="i" aria-hidden /><span>Songs and folders you add later show up by themselves.</span></li>
        <li><Search className="i" aria-hidden /><span>Search, sort and play. The space bar and your media keys work too.</span></li>
      </ul>
      <AddFolderButton primary />
      {libraryError !== null && <p className="message err" role="alert">{libraryError}</p>}
    </div>
  )
}

/** The picture of a playlist: the first song of it that has a cover. Without one, an icon. */
function PlaylistCover({ songs }: { songs: Song[] }) {
  const [tried, setTried] = useState(0)
  const candidate = songs.length > 0 && tried < Math.min(songs.length, 8) ? songs[tried] : null
  return (
    <span className="head-cover">
      {candidate === null ? (
        <ListMusic className="i" aria-hidden />
      ) : (
        <img key={candidate.path} src={window.brita.coverUrl(candidate.path)} alt="" onError={() => setTried(tried + 1)} />
      )}
    </span>
  )
}

function SearchBox({ total }: { total: number }) {
  const query = useMusic((state) => state.query)
  const setQuery = useMusic((state) => state.setQuery)
  if (total === 0) return null
  return (
    <div className="field search" role="search">
      <label htmlFor={SEARCH_ID}>Search songs</label>
      <div className="search-box">
        <Search className="i" aria-hidden />
        <input
          id={SEARCH_ID}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Title, artist or album"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
        />
        {query !== '' && (
          <button type="button" className="icon-btn" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')}>
            <X className="i" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'title', label: 'Title', className: '' },
  { key: 'artist', label: 'Artist', className: ' col-artist' },
  { key: 'album', label: 'Album', className: ' col-album' },
  { key: 'length', label: 'Length', className: ' col-length' },
]

/** The column titles. A click sorts by that column; the arrow shows which way. */
function SongsHead() {
  const sort = useMusic((state) => state.sort)
  const toggleSort = useMusic((state) => state.toggleSort)
  return (
    <div className="songs-head">
      <span>#</span>
      {COLUMNS.map((column) => {
        const active = sort !== null && sort.key === column.key
        const Arrow = active && sort.descending ? ArrowDown : ArrowUp
        const direction = !active ? '' : sort.descending ? ', Z to A' : ', A to Z'
        return (
          <button
            key={column.key}
            type="button"
            className={`head-btn${column.className}${active ? ' on' : ''}`}
            aria-label={`Sort by ${column.label}${direction}`}
            title={`Sort by ${column.label.toLowerCase()}`}
            onClick={() => toggleSort(column.key)}
          >
            {column.label}
            {active && <Arrow className="i" aria-hidden />}
          </button>
        )
      })}
      <span />
    </div>
  )
}

function SongList() {
  const library = useMusic((state) => state.library)
  const view = useMusic((state) => state.view)
  const query = useMusic((state) => state.query)
  const sort = useMusic((state) => state.sort)
  const current = useMusic((state) => state.current)
  const playing = useMusic((state) => state.playing)
  const playFrom = useMusic((state) => state.playFrom)
  const playList = useMusic((state) => state.playList)
  const setQuery = useMusic((state) => state.setQuery)
  const libraryError = useMusic((state) => state.libraryError)
  const loading = useMusic((state) => state.loading)
  const progress = useMusic((state) => state.progress)
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu((open) => {
      if (restoreFocus && open?.opener.isConnected) open.opener.focus()
      return null
    })
  }, [])

  const favorites = useMusic((state) => state.favorites)
  const plays = useMusic((state) => state.plays)
  const all = useMemo(() => songsInView(library, view, favorites, plays), [library, view, favorites, plays])
  const songs = useMemo(() => visibleSongs(library, view, favorites, plays, query, sort), [library, view, favorites, plays, query, sort])
  const playlist = library.playlists.find((item) => item.key === view)
  const automatic = AUTOMATIC_LISTS.find((list) => list.view === view)
  const title = automatic?.title ?? playlist?.name ?? 'All songs'
  const searching = query.trim() !== ''
  const count = (n: number) => (n === 1 ? '1 song' : `${n} songs`)
  const countText = loading ? 'Reading your folders' : searching ? `${songs.length} of ${count(all.length)}` : count(all.length)

  return (
    <>
      <header className="view-head">
        {automatic !== undefined ? (
          <span className="head-cover"><automatic.Icon className="i" aria-hidden /></span>
        ) : playlist === undefined ? (
          <span className="head-cover"><LibraryIcon className="i" aria-hidden /></span>
        ) : (
          <PlaylistCover key={view} songs={all} />
        )}
        <div className="head-text">
          <h1>{title}</h1>
          <p className="muted">
            {countText}
            {progress !== null && <span className="reading" role="status"> · Reading song details: {progress.done} of {progress.total}</span>}
          </p>
          {songs.length > 0 && (
            <div className="head-actions">
              <button type="button" className="btn btn-primary" onClick={() => playList(songs, false)}>
                <Play className="i" aria-hidden /> Play
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => playList(songs, true)}>
                <Shuffle className="i" aria-hidden /> Shuffle
              </button>
            </div>
          )}
        </div>
        <SearchBox total={all.length} />
      </header>
      {libraryError !== null && <p className="message err" role="alert">{libraryError}</p>}
      {library.missing.length > 0 && (
        <p className="message warn" role="status">
          {missingText(library.missing)} Is the drive connected? Brita Music looks again by itself.
        </p>
      )}
      {library.unreadable.length > 0 && (
        <p className="message warn" role="status">
          {library.unreadable.length === 1 ? '1 folder' : `${library.unreadable.length} folders`} could not be read, so songs may be missing.
        </p>
      )}
      {all.length === 0 ? (
        !loading && (
          <p className="empty muted">
            {automatic?.empty ?? 'No music files here yet. Copy songs into this folder.'}
          </p>
        )
      ) : songs.length === 0 ? (
        <p className="empty muted" role="status">
          No song matches “{query.trim()}”.{' '}
          <button type="button" className="link-btn" onClick={() => setQuery('')}>Clear search</button>
        </p>
      ) : (
        <>
          <SongsHead />
          <ol className="songs">
            {songs.map((song, index) => (
              <li key={song.path}>
                <button
                  type="button"
                  className={`song${current?.path === song.path ? ' on' : ''}`}
                  aria-current={current?.path === song.path ? 'true' : undefined}
                  onClick={() => playFrom(song, songs)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ song, x: event.clientX, y: event.clientY, opener: event.currentTarget })
                  }}
                >
                  <span className="song-no">
                    {current?.path === song.path && playing ? <Volume2 className="i" role="img" aria-label="Playing" /> : index + 1}
                  </span>
                  <span className="song-main">
                    <Cover song={song} className="thumb" />
                    <span className="song-title">{song.title}</span>
                  </span>
                  <span className="song-artist col-artist">{song.artist}</span>
                  <span className="song-album col-album">{song.album}</span>
                  <span className="song-length col-length">{lengthOf(song)}</span>
                  <span className="badge neutral">{song.ext}</span>
                </button>
                <HeartButton path={song.path} title={song.title} className="icon-btn row-heart" label={`Favorite: ${song.title}`} />
              </li>
            ))}
          </ol>
        </>
      )}
      {menu !== null && <SongMenu target={menu} onClose={closeMenu} />}
    </>
  )
}


function PlayerBar() {
  const current = useMusic((state) => state.current)
  const playing = useMusic((state) => state.playing)
  const time = useMusic((state) => state.time)
  const duration = useMusic((state) => state.duration)
  const playError = useMusic((state) => state.playError)
  const notice = useMusic((state) => state.notice)
  const shuffle = useMusic((state) => state.shuffle)
  const repeat = useMusic((state) => state.repeat)
  const togglePlay = useMusic((state) => state.togglePlay)
  const next = useMusic((state) => state.next)
  const previous = useMusic((state) => state.previous)
  const seek = useMusic((state) => state.seek)
  const toggleShuffle = useMusic((state) => state.toggleShuffle)
  const cycleRepeat = useMusic((state) => state.cycleRepeat)

  const noSong = current === null
  const disabled = noSong || playError !== null
  const percent = duration > 0 ? (Math.min(time, duration) / duration) * 100 : 0
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  return (
    <footer className="player">
      <div className="now">
        {current !== null && <Cover key={current.path} song={current} className="now-cover" />}
        <div className="now-text">
          {current === null ? <span className="dim">Pick a song to play</span> : <span className="now-title">{current.title}</span>}
          {current !== null && current.artist !== '' && <span className="now-artist">{current.artist}</span>}
          {playError !== null && <span className="now-error" role="alert">{playError}</span>}
          {notice !== null && <span className="now-notice" role="status">{notice}</span>}
        </div>
        {current !== null && <HeartButton path={current.path} title={current.title} className="ctl now-heart" label="Favorite" />}
      </div>
      <div className="transport">
        <div className="controls">
          <button
            type="button"
            className={`ctl${shuffle ? ' on' : ''}`}
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            title={shuffle ? 'Shuffle is on' : 'Shuffle is off'}
          >
            <Shuffle className="i" aria-hidden />
          </button>
          <button type="button" className="ctl" onClick={previous} disabled={noSong} aria-label="Previous song" title="Previous song">
            <SkipBack className="i" aria-hidden />
          </button>
          <button
            type="button"
            className="play"
            onClick={togglePlay}
            disabled={disabled}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="i" aria-hidden /> : <Play className="i" aria-hidden />}
          </button>
          <button type="button" className="ctl" onClick={next} disabled={noSong} aria-label="Next song" title="Next song">
            <SkipForward className="i" aria-hidden />
          </button>
          <button
            type="button"
            className={`ctl${repeat === 'off' ? '' : ' on'}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${repeat}`}
            title={repeat === 'off' ? 'Repeat is off' : repeat === 'all' ? 'Repeating the whole list' : 'Repeating this song'}
          >
            <RepeatIcon className="i" aria-hidden />
          </button>
        </div>
        <div className="seek">
          <span className="clock">{formatTime(time)}</span>
          <input
            type="range"
            aria-label="Position in the song"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(time, duration || 1)}
            disabled={disabled || duration === 0}
            style={{ '--fill': `${percent}%` } as CSSProperties}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <span className="clock">{formatTime(duration)}</span>
        </div>
      </div>
      <VolumeControl />
    </footer>
  )
}

/** The button next to the volume and its short list of sound outputs (speakers, headphones, Bluetooth, HDMI). */
function OutputControl() {
  const outputs = useMusic((state) => state.outputs)
  const outputId = useMusic((state) => state.outputId)
  const open = useMusic((state) => state.outputOpen)
  const toggleOutputList = useMusic((state) => state.toggleOutputList)
  const closeOutputList = useMusic((state) => state.closeOutputList)
  const setOutput = useMusic((state) => state.setOutput)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const items = () => [...(wrap.current?.querySelectorAll<HTMLButtonElement>('.out-item') ?? [])]

  // Puts the focus on the output in use, so the arrow keys start from there.
  useEffect(() => {
    if (!open) return
    const chosen = items().find((item) => item.getAttribute('aria-checked') === 'true')
    ;(chosen ?? items()[0])?.focus()
  }, [open])

  // A click anywhere else, or leaving the window, closes the list.
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => {
      if (event.target instanceof Node && wrap.current?.contains(event.target)) return
      closeOutputList()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('blur', closeOutputList)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('blur', closeOutputList)
    }
  }, [open, closeOutputList])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number) => { event.preventDefault(); list[(index + list.length) % list.length]?.focus() }
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at === -1 ? -1 : at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(-1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeOutputList()
      button.current?.focus()
    }
  }

  const inUse = outputs.find((device) => device.id === outputId)
  return (
    <div className="out-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`ctl${open ? ' on' : ''}`}
        onClick={toggleOutputList}
        aria-label="Sound output"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Sound output: ${inUse?.label ?? 'System default'}`}
      >
        <Speaker className="i" aria-hidden />
      </button>
      {open && (
        <div className="out-menu" role="menu" aria-label="Sound output">
          {outputs.map((device) => (
            <button
              key={device.id === '' ? 'default' : device.id}
              type="button"
              role="menuitemradio"
              aria-checked={device.id === outputId}
              className="out-item"
              onClick={() => void setOutput(device.id)}
            >
              <span className="out-name">{device.label}</span>
              {device.id === outputId && <Check className="i" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The moon button next to the sound output: a short list to stop the music after some minutes or after the song. */
function SleepControl() {
  const sleep = useMusic((state) => state.sleep)
  const left = useMusic((state) => state.sleepLeft)
  const setSleep = useMusic((state) => state.setSleep)
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  const items = () => [...(wrap.current?.querySelectorAll<HTMLButtonElement>('.sleep-item') ?? [])]
  const close = useCallback(() => setOpen(false), [])

  // Puts the focus on the first entry, so the arrow keys work at once.
  useEffect(() => {
    if (open) items()[0]?.focus()
  }, [open])

  // A click anywhere else, or leaving the window, closes the list.
  useEffect(() => {
    if (!open) return
    const away = (event: Event) => {
      if (event.target instanceof Node && wrap.current?.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('blur', close)
    }
  }, [open, close])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number) => { event.preventDefault(); list[(index + list.length) % list.length]?.focus() }
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at === -1 ? -1 : at - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(-1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      close()
      button.current?.focus()
    }
  }

  const choose = (choice: number | 'song' | null) => {
    setSleep(choice)
    close()
  }

  const label = sleepLabel(sleep, left)
  return (
    <div className="sleep-wrap" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`ctl${sleep.kind === 'off' ? '' : ' on wide'}`}
        onClick={() => setOpen(!open)}
        aria-label="Sleep timer"
        aria-haspopup="menu"
        aria-expanded={open}
        title={sleepTitle(sleep, left)}
      >
        <Moon className="i" aria-hidden />
        {label !== '' && <span className="sleep-left">{label}</span>}
      </button>
      {open && (
        <div className="sleep-menu" role="menu" aria-label="Sleep timer">
          {SLEEP_MINUTES.map((minutes) => (
            <button key={minutes} type="button" role="menuitem" className="sleep-item" onClick={() => choose(minutes)}>
              Stop after {minutes} minutes
            </button>
          ))}
          <button type="button" role="menuitem" className="sleep-item" onClick={() => choose('song')}>Stop after this song</button>
          {sleep.kind !== 'off' && (
            <button type="button" role="menuitem" className="sleep-item sleep-cancel" onClick={() => choose(null)}>Turn off the timer</button>
          )}
        </div>
      )}
    </div>
  )
}

function VolumeControl() {
  const volume = useMusic((state) => state.volume)
  const muted = useMusic((state) => state.muted)
  const setVolume = useMusic((state) => state.setVolume)
  const toggleMute = useMusic((state) => state.toggleMute)
  const queueOpen = useMusic((state) => state.queueOpen)
  const toggleQueue = useMusic((state) => state.toggleQueue)

  const silent = muted || volume === 0
  const shown = silent ? 0 : volume
  const Icon = silent ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="volume">
      <button
        type="button"
        className="ctl"
        onClick={toggleMute}
        aria-label={silent ? 'Unmute' : 'Mute'}
        aria-pressed={silent}
        title={silent ? 'Unmute' : 'Mute'}
      >
        <Icon className="i" aria-hidden />
      </button>
      <input
        type="range"
        className="volume-slider"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        style={{ '--fill': `${shown * 100}%` } as CSSProperties}
        onChange={(event) => setVolume(Number(event.target.value))}
      />
      <OutputControl />
      <SleepControl />
      <button type="button" className="ctl" onClick={() => window.brita.openMiniPlayer()} aria-label="Mini player" title="Open the mini player">
        <PictureInPicture2 className="i" aria-hidden />
      </button>
      <button
        type="button"
        className={`ctl${queueOpen ? ' on' : ''}`}
        onClick={toggleQueue}
        aria-label="Playing next"
        aria-pressed={queueOpen}
        title={queueOpen ? 'Close the queue' : 'Show what plays next'}
      >
        <ListOrdered className="i" aria-hidden />
      </button>
    </div>
  )
}
