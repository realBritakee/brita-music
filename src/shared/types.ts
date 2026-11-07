/** What is read from a music file's tags. Empty text means the file does not say. */
export interface Details {
  title: string
  artist: string
  album: string
  /** Length in seconds, or null if the file does not tell. */
  duration: number | null
}

export interface Song extends Details {
  /** Full file path. It also identifies the song. */
  path: string
  /** File extension in lower case, without the dot. */
  ext: string
  /** Key of the playlist the song belongs to, or null if it lies directly in a music folder. */
  playlist: string | null
}

export interface Playlist {
  /** The name in lower case, so the same name in two music folders becomes one playlist. */
  key: string
  name: string
}

export interface Library {
  folders: string[]
  playlists: Playlist[]
  songs: Song[]
  /** Folders that could not be read, for example because of missing rights. */
  unreadable: string[]
  /** Music folders that do not exist right now, for example because the drive is not connected. */
  missing: string[]
}

/** The answer to "New playlist": the folder was made, or a plain-words reason why not. */
export type CreateResult = { ok: true; name: string } | { ok: false; message: string }

/** What happened after something was dropped on the window. `message` is plain words for the person, or null if there is nothing to say. */
export interface DropResult {
  /** Music folders that were added. */
  added: number
  /** Songs that were copied into a playlist. */
  copied: number
  message: string | null
}

/** How far the background reading of song details has come. */
export interface Progress {
  done: number
  total: number
}

export type RepeatMode = 'off' | 'all' | 'one'

/** At start, shuffle (or repeat) is either what it was last time or a fixed value. */
export type ShuffleAtStart = 'remember' | 'on' | 'off'
export type RepeatAtStart = 'remember' | RepeatMode

/** What the person chooses on the settings page. */
export interface Preferences {
  /** Continue with the last song as soon as the app starts; otherwise it waits paused. */
  startPlaying: boolean
  /** Seconds a song must have played before "previous" restarts it instead of going back. 0 means never restart. */
  restartAfter: number
  shuffleAtStart: ShuffleAtStart
  repeatAtStart: RepeatAtStart
  /** Closing the window keeps the music playing and leaves a tray icon; otherwise closing quits. */
  closeToTray: boolean
}

/** What the player remembers between starts. */
export interface Settings extends Preferences {
  /** 0 (silent) to 1 (full). */
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  /** Path of the song that was loaded when the app closed, or null. */
  lastSong: string | null
  /** The sound output the person picked (a device id of the browser), or '' for the system default. */
  outputDevice: string
}

/** How often a song was played and when it was played last (milliseconds since 1970). */
export interface Play {
  /** Full file path of the song. */
  path: string
  count: number
  last: number
}

/** A keyboard media key, pressed while any program has the focus. */
export type MediaKey = 'play-pause' | 'next' | 'previous' | 'stop'

/** What the window tells the tray, the taskbar and the mini player about the player. */
export interface PlaybackReport {
  playing: boolean
  /** The loaded song, or null if none is loaded. `path` is the song's file path ('' if unknown); it names the song's cover. */
  song: { title: string; artist: string; path: string } | null
}

/** The buttons of the mini player. The main window carries them out, like a media key. */
export type MiniKey = 'previous' | 'play-pause' | 'next'

/**
 * Where the check for a new version stands. `none` and `error` only appear after the person pressed
 * "Check for updates"; a check at start stays silent unless it finds a new version.
 */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none' }
  /** `problem` is set when a download of this version failed; the person can try again. */
  | { kind: 'available'; version: string; problem?: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

/** What the Download page's browser view shows right now. `url` is empty before the view has started. */
export interface BrowserState {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

/** A rectangle in window pixels: where the browser view sits on the Download page. */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserMove = 'back' | 'forward' | 'reload'

/** The video that plays in the Download page's browser, as the page reports it. */
export interface VideoState {
  title: string
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  /** YouTube offers a next (or previous) video on this page. */
  canNext: boolean
  canPrevious: boolean
}

/** What the player bar, the media keys and the taskbar buttons can ask the video to do. */
export type VideoCommand =
  | { type: 'toggle' }
  | { type: 'pause' }
  | { type: 'mute' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; volume: number }

export interface BritaApi {
  /** The remembered library, at once. The fresh one follows through onLibrary. */
  loadLibrary(): Promise<Library>
  /** Opens the folder window. True if a folder was chosen; the library then arrives through onLibrary. */
  addFolder(): Promise<boolean>
  /** Makes the app forget a music folder. The folder and its files on the PC stay untouched. The fresh library arrives through onLibrary. */
  removeFolder(folder: string): Promise<void>
  /** Makes a new, empty folder called `name` inside the music folder `folder`. The playlist then arrives through onLibrary. */
  createPlaylist(folder: string, name: string): Promise<CreateResult>
  /** The file paths of files dropped on the window (the browser hides them; this reads them). */
  pathsOf(files: File[]): string[]
  /**
   * Handles a drop. Without `playlist`, dropped folders become music folders. With a playlist key, dropped songs
   * are copied into that playlist's folder. Nothing is moved or overwritten. The library then arrives through onLibrary.
   */
  dropItems(paths: string[], playlist: string | null): Promise<DropResult>
  /** Opens Windows Explorer with the song's file selected. False if the file is gone or is not a song of the library. */
  showInFolder(path: string): Promise<boolean>
  /** Puts the song's file path on the clipboard. False if it is not a song of the library. */
  copyPath(path: string): Promise<boolean>
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): void
  /** The paths of the songs the person gave a heart. They are kept in the app's own data folder. */
  loadFavorites(): Promise<string[]>
  saveFavorites(songs: string[]): void
  /** How often each song was played, and when last. They are kept in the app's own data folder. */
  loadHistory(): Promise<Play[]>
  saveHistory(plays: Play[]): void
  /** The folder where the app keeps its own files (library list, settings, window position). */
  dataFolder(): Promise<string>
  /** The version of the running program, for example "0.2.0". */
  appVersion(): Promise<string>
  /** Where the update check stands right now. Later changes arrive through onUpdate. */
  updateState(): Promise<UpdateState>
  /** Looks for a newer version because the person asked. The answer arrives through onUpdate. */
  checkForUpdates(): Promise<void>
  /** Downloads the version that was found. Only the person's click starts this. */
  downloadUpdate(): Promise<void>
  /** Closes the program, installs the downloaded version and starts it again. */
  installUpdate(): Promise<void>
  onUpdate(listener: (state: UpdateState) => void): () => void
  /** Shows the browser view at this place in the window (the first call opens youtube.com). Call again when the place changes. */
  placeBrowser(bounds: BrowserBounds): void
  /** Hides the browser view and pauses its video. */
  hideBrowser(): void
  /** Back, forward or reload in the browser view. */
  moveBrowser(move: BrowserMove): void
  /** Opens the typed text in the browser view: a web address as it is, other words as a YouTube search. False if it cannot be opened. */
  goBrowser(text: string): Promise<boolean>
  /** Tells the video in the browser what to do (play or pause, seek, volume, next, previous). */
  controlVideo(command: VideoCommand): void
  /** The video in the browser, about twice a second while there is one; null when there is none. */
  onVideo(listener: (state: VideoState | null) => void): () => void
  browserState(): Promise<BrowserState>
  onBrowser(listener: (state: BrowserState) => void): () => void
  /** Tells the tray menu, the taskbar and the mini player whether music plays and which song is loaded. */
  reportPlayback(report: PlaybackReport): void
  /** Opens the mini player, or brings it forward if it is open. */
  openMiniPlayer(): void
  /** Closes the mini player. The music goes on. */
  closeMiniPlayer(): void
  /** Brings the main window back (from the tray or from behind other windows). */
  showMainWindow(): void
  /** What the player last reported, for the mini player to start from. Later changes arrive through onPlayback. */
  playbackState(): Promise<PlaybackReport>
  onPlayback(listener: (report: PlaybackReport) => void): () => void
  /** A button of the mini player: the main window plays, pauses or skips. */
  controlPlayer(key: MiniKey): void
  /** Called when a media key is pressed (or a tray menu entry is chosen). Returns a function that stops listening. */
  onMediaKey(listener: (key: MediaKey) => void): () => void
  /** Called when a fresh library is ready. Returns a function that stops listening. */
  onLibrary(listener: (library: Library) => void): () => void
  /** Called while song details are read. null means reading is finished. */
  onProgress(listener: (progress: Progress | null) => void): () => void
  songUrl(path: string): string
  coverUrl(path: string): string
}
