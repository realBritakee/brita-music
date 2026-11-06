import { create } from 'zustand'
import { DEFAULT_RESTART_AFTER } from '../../shared/choices'
import type { CreateResult, Library, MediaKey, Play, Preferences, Progress, RepeatMode, Settings, Song, UpdateState } from '../../shared/types'
import { FAVORITES_VIEW, onlyFavorites, toggled } from './favorites'
import { heardBetween, mostPlayedSongs, MOST_VIEW, recentSongs, RECENT_VIEW, recordPlay, secondsToCount } from './history'
import { listOutputs, pickOutput, type OutputDevice } from './output'
import { repeatAtStart, restartsSong, shuffleAtStart } from './prefs'
import { isInsideAny, neighbour, placeAfter, placeLast, shuffled, upcoming, without } from './queue'
import { filterSongs, nextSort, sortSongs, type Sort, type SortKey } from './search'
import { fadeFactor, FADE_SECONDS, secondsLeft, sleepAfter, SLEEP_OFF, type SleepTimer } from './sleep'

/** "all" shows every song; FAVORITES_VIEW, RECENT_VIEW and MOST_VIEW are the automatic lists; any other value is the key of a playlist. */
export type View = 'all' | string

/** The two screens of the window: the song list, or the settings. */
export type Page = 'library' | 'settings'

const EMPTY_LIBRARY: Library = { folders: [], playlists: [], songs: [], unreadable: [], missing: [] }
const DEFAULT_PREFERENCES: Preferences = { startPlaying: false, restartAfter: DEFAULT_RESTART_AFTER, shuffleAtStart: 'remember', repeatAtStart: 'remember', closeToTray: false }
const NOTICE_SECONDS = 8
const OPEN_NEW_PLAYLIST_SECONDS = 15
/** The queue panel lists at most this many songs; a library of 20,000 songs must not become 20,000 rows. */
const QUEUE_SHOWN = 200

const audio = new Audio()

let gotFreshLibrary = false

/** Paths in the order of the list the person started from. */
let queue: string[] = []
/** Paths in the order they play: the queue, or a shuffled copy of it. */
let order: string[] = []
/** The song of the last session, loaded as soon as the library knows it. */
let restorePath: string | null = null
let settingsReady = false
/** True once the saved favorites were read. Before that, a heart is not written to disk, so nothing saved can be lost. */
let favoritesReady = false
/** True once the saved play history was read. Before that, a play is not written to disk, so nothing saved can be lost. */
let historyReady = false
/** Seconds of the current song that were really heard (a jump forward does not count), and whether the song already counted as played. */
let heard = 0
let counted = false
/** The playing time at the last update, to measure the step to the next one. */
let lastTime = 0
/** True while the current song was started by the player itself (the song before it ended or failed). */
let automatic = false
let skips = 0
/** A playlist the person just made: shown as soon as the library lists it. */
let openNext: { key: string; until: number } | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined

/** After a new library arrives, the playing song gets its newly read details. */
function refreshed(current: Song | null, library: Library): Song | null {
  if (current === null) return null
  return library.songs.find((song) => song.path === current.path) ?? current
}

interface MusicState {
  library: Library
  page: Page
  /** What the person chose on the settings page. */
  prefs: Preferences
  view: View
  /** What is typed in the search box; it filters the list on screen. */
  query: string
  /** The column the list is sorted by; null is the order of the folders. */
  sort: Sort
  /** True from asking for the library until the first fresh one arrives. */
  loading: boolean
  /** How far reading song details has come; null when nothing is being read. */
  progress: Progress | null
  libraryError: string | null
  current: Song | null
  playing: boolean
  time: number
  duration: number
  playError: string | null
  /** A short remark such as "Skipped a song"; it disappears by itself. */
  notice: string | null
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  /** True while the "Playing next" panel is open. */
  queueOpen: boolean
  /** The first songs that play after the current one, in the order they will play. */
  upcoming: Song[]
  /** How many songs play after the current one (can be more than `upcoming` holds). */
  upcomingCount: number
  /** Where the check for a new version stands. */
  update: UpdateState
  /** The version whose message the person closed with "Later"; the message does not come back for it. */
  laterVersion: string | null
  /** The sound outputs of the PC; the first one is the system default. */
  outputs: OutputDevice[]
  /** The output in use: a device id, or '' for the system default. */
  outputId: string
  /** True while the list of sound outputs is open. */
  outputOpen: boolean
  /** Paths of the songs with a heart. */
  favorites: string[]
  /** How often each song was played, and when last. */
  plays: Play[]
  /** The sleep timer. It is never saved: after a restart it is off. */
  sleep: SleepTimer
  /** Seconds until a timed sleep ends (0 when the timer is off or counts songs). */
  sleepLeft: number
  start(): Promise<void>
  /** Starts the sleep timer: a number of minutes, or 'song' for the end of the song that plays. null cancels it. */
  setSleep(choice: number | 'song' | null): void
  /** Gives a song a heart, or takes it away again. */
  toggleFavorite(path: string): void
  /** Opens or closes the list of sound outputs (looking at the connected devices again when it opens). */
  toggleOutputList(): void
  closeOutputList(): void
  /** Plays through this output from now on ('' is the system default). */
  setOutput(id: string): Promise<void>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  /** Hides the update message for this version. */
  postponeUpdate(): void
  addFolder(): Promise<void>
  removeFolder(folder: string): Promise<void>
  /** Handles files or folders dropped on the window: onto a playlist (its key) they are copied there, elsewhere folders are added. */
  dropFiles(files: File[], playlist: string | null): Promise<void>
  /** Makes a new folder in a music folder; on success the new, empty playlist is shown. */
  createPlaylist(folder: string, name: string): Promise<CreateResult>
  /** Shows the song list or the settings. */
  setPage(page: Page): void
  setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void
  setView(view: View): void
  setQuery(query: string): void
  /** A click on a column title: A to Z, then Z to A, then the folder order again. */
  toggleSort(key: SortKey): void
  /** Plays a song; the songs after it are the rest of `list`. */
  playFrom(song: Song, list: Song[]): void
  togglePlay(): void
  next(): void
  previous(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  toggleMute(): void
  toggleShuffle(): void
  cycleRepeat(): void
  toggleQueue(): void
  /** Takes a song out of the play order; it is skipped. */
  removeFromQueue(path: string): void
  /** Moves a song to play right after the current one. */
  playNext(path: string): void
  /** Moves a song to the end of the play order. */
  addToQueue(path: string): void
  /** Opens Windows Explorer with the song's file selected. */
  revealSong(path: string): Promise<void>
  copyPath(path: string): Promise<void>
  /** Shows every song of an artist or album: all songs, with the search box filled in. */
  goTo(value: string): void
}

export const useMusic = create<MusicState>((set, get) => ({
  library: EMPTY_LIBRARY,
  page: 'library',
  prefs: DEFAULT_PREFERENCES,
  view: 'all',
  query: '',
  sort: null,
  loading: false,
  progress: null,
  libraryError: null,
  current: null,
  playing: false,
  time: 0,
  duration: 0,
  playError: null,
  notice: null,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  queueOpen: false,
  upcoming: [],
  upcomingCount: 0,
  update: { kind: 'idle' },
  laterVersion: null,
  outputs: [{ id: '', label: 'System default' }],
  outputId: '',
  outputOpen: false,
  favorites: [],
  plays: [],
  sleep: SLEEP_OFF,
  sleepLeft: 0,

  setSleep(choice) {
    clearSleep()
    if (choice === null) return
    if (choice === 'song') {
      useMusic.setState({ sleep: { kind: 'song' } })
      return
    }
    const timer = sleepAfter(choice, Date.now())
    useMusic.setState({ sleep: timer, sleepLeft: secondsLeft(timer.endsAt, Date.now()) })
    sleepTick = setInterval(tickSleep, SLEEP_TICK_MS)
  },

  async start() {
    await restoreSettings()
    await restoreFavorites()
    await restorePlays()
    watchOutputs()
    window.brita.onUpdate((update) => set({ update }))
    window.brita.updateState().then((update) => set((state) => (state.update.kind === 'idle' ? { update } : {}))).catch((error: unknown) => console.error('Could not read the update state', error))
    window.brita.onMediaKey(handleMediaKey)
    window.brita.onLibrary((library) => {
      gotFreshLibrary = true
      set((state) => ({ library, loading: false, current: refreshed(state.current, library) }))
      afterLibrary(library)
      publishUpcoming()
    })
    window.brita.onProgress((progress) => set({ progress }))
    try {
      const library = await window.brita.loadLibrary()
      if (gotFreshLibrary) return
      set({ library, loading: library.folders.length > 0 })
      afterLibrary(library)
    } catch (error) {
      console.error('Loading the library failed', error)
      set({ libraryError: 'The music library could not be loaded.' })
    }
  },

  toggleFavorite(path) {
    const favorites = toggled(get().favorites, path)
    set({ favorites })
    if (!favoritesReady) {
      showNotice('Your favorites could not be loaded, so this heart is not saved.')
      return
    }
    window.brita.saveFavorites(favorites)
  },

  toggleOutputList() {
    const open = !get().outputOpen
    set({ outputOpen: open })
    if (open) void refreshOutputs()
  },

  closeOutputList() {
    set({ outputOpen: false })
  },

  async setOutput(id) {
    set({ outputOpen: false })
    await switchOutput(id, 'That sound output could not be used. Playing through the system default.')
  },

  async checkForUpdates() {
    await window.brita.checkForUpdates()
  },

  async downloadUpdate() {
    await window.brita.downloadUpdate()
  },

  async installUpdate() {
    await window.brita.installUpdate()
  },

  postponeUpdate() {
    const { update } = get()
    if ('version' in update) set({ laterVersion: update.version })
  },

  async addFolder() {
    set({ loading: true, libraryError: null })
    try {
      const chosen = await window.brita.addFolder()
      if (!chosen) set({ loading: false })
    } catch (error) {
      console.error('Adding a folder failed', error)
      set({ loading: false, libraryError: 'That folder could not be added. Try another one.' })
    }
  },

  async removeFolder(folder) {
    set({ libraryError: null })
    try {
      await window.brita.removeFolder(folder)
    } catch (error) {
      console.error('Removing a folder failed', error)
      set({ libraryError: 'That folder could not be removed.' })
    }
  },

  async dropFiles(files, playlist) {
    let paths: string[] = []
    try {
      paths = window.brita.pathsOf(files)
    } catch (error) {
      console.error('Reading the dropped files failed', error)
    }
    if (paths.length === 0) {
      showNotice('Nothing could be read from that drop. Drop files or folders from Windows Explorer.')
      return
    }
    try {
      const result = await window.brita.dropItems(paths, playlist)
      if (result.added > 0) set({ loading: true, libraryError: null })
      showNotice(result.message)
    } catch (error) {
      console.error('Handling the drop failed', error)
      set({ loading: false })
      showNotice('The drop could not be handled.')
    }
  },

  async createPlaylist(folder, name) {
    try {
      const result = await window.brita.createPlaylist(folder, name)
      if (result.ok) {
        openNext = { key: result.name.toLowerCase(), until: Date.now() + OPEN_NEW_PLAYLIST_SECONDS * 1000 }
        afterLibrary(get().library)
      }
      return result
    } catch (error) {
      console.error('Creating a playlist failed', error)
      return { ok: false, message: 'The playlist could not be created.' }
    }
  },

  setPage(page) {
    set({ page })
  },

  setPreference(key, value) {
    set({ prefs: { ...get().prefs, [key]: value } })
    saveSoon()
  },

  setView(view) {
    // A search belongs to the list it was typed in. Picking a list also leaves the settings.
    set({ view, query: '', page: 'library' })
  },

  setQuery(query) {
    set({ query })
  },

  toggleSort(key) {
    set({ sort: nextSort(get().sort, key) })
  },

  playFrom(song, list) {
    setQueue(list.map((item) => item.path), song.path)
    load(song, true, false)
  },

  togglePlay() {
    const { current, playing, playError } = get()
    if (current === null || playError !== null) return
    if (playing) audio.pause()
    else startPlayback()
  },

  next() {
    const song = step(1)
    if (song !== null) load(song, true, false)
  },

  previous() {
    if (get().current === null) return
    if (restartsSong(audio.currentTime, get().prefs.restartAfter)) {
      get().seek(0)
      return
    }
    const song = step(-1)
    if (song === null) get().seek(0)
    else load(song, true, false)
  },

  seek(seconds) {
    audio.currentTime = seconds
    lastTime = seconds
    set({ time: seconds })
  },

  setVolume(volume) {
    const clamped = Math.min(Math.max(volume, 0), 1)
    audio.volume = clamped
    if (clamped > 0) audio.muted = false
    set({ volume: clamped, muted: audio.muted })
    saveSoon()
  },

  toggleMute() {
    if (audio.muted && audio.volume === 0) audio.volume = 0.5
    audio.muted = !audio.muted
    set({ muted: audio.muted, volume: audio.volume })
    saveSoon()
  },

  toggleShuffle() {
    const shuffle = !get().shuffle
    set({ shuffle })
    order = shuffle ? shuffled(queue, get().current?.path ?? null) : queue
    publishUpcoming()
    saveSoon()
  },

  cycleRepeat() {
    const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
    set({ repeat: next[get().repeat] })
    saveSoon()
  },

  toggleQueue() {
    set({ queueOpen: !get().queueOpen })
  },

  removeFromQueue(path) {
    if (get().current?.path === path) return
    ensureQueue()
    queue = without(queue, path)
    order = without(order, path)
    publishUpcoming()
  },

  playNext(path) {
    const current = get().current
    if (current === null || current.path === path) return
    ensureQueue()
    queue = placeAfter(queue, path, current.path)
    order = placeAfter(order, path, current.path)
    publishUpcoming()
  },

  addToQueue(path) {
    const current = get().current
    if (current === null || current.path === path) return
    ensureQueue()
    queue = placeLast(queue, path)
    order = placeLast(order, path)
    publishUpcoming()
  },

  async revealSong(path) {
    if (await askMain(() => window.brita.showInFolder(path))) return
    showNotice('That file is no longer there.')
  },

  async copyPath(path) {
    if (await askMain(() => window.brita.copyPath(path))) return
    showNotice('The path could not be copied.')
  },

  goTo(value) {
    set({ view: 'all', page: 'library', query: value })
  },
}))

/** The answer of a call to the main process; a failed call counts as "no". */
async function askMain(call: () => Promise<boolean>): Promise<boolean> {
  try {
    return await call()
  } catch (error) {
    console.error('A song action failed', error)
    return false
  }
}

// ---------- settings ----------

async function restoreSettings(): Promise<void> {
  let settings: Settings = { volume: 1, muted: false, shuffle: false, repeat: 'off', lastSong: null, outputDevice: '', ...DEFAULT_PREFERENCES }
  try {
    settings = await window.brita.loadSettings()
  } catch (error) {
    console.error('Loading the settings failed', error)
  }
  audio.volume = settings.volume
  audio.muted = settings.muted
  restorePath = settings.lastSong
  const { startPlaying, restartAfter, shuffleAtStart: shuffleChoice, repeatAtStart: repeatChoice, closeToTray } = settings
  useMusic.setState({
    volume: settings.volume,
    muted: settings.muted,
    shuffle: shuffleAtStart(shuffleChoice, settings.shuffle),
    repeat: repeatAtStart(repeatChoice, settings.repeat),
    outputId: settings.outputDevice,
    prefs: { startPlaying, restartAfter, shuffleAtStart: shuffleChoice, repeatAtStart: repeatChoice, closeToTray },
  })
  settingsReady = true
}

function saveSoon(): void {
  if (!settingsReady) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSettings, 300)
}

function flushSettings(): void {
  if (!settingsReady) return
  clearTimeout(saveTimer)
  const { volume, muted, shuffle, repeat, current, prefs, outputId } = useMusic.getState()
  window.brita.saveSettings({ volume, muted, shuffle, repeat, lastSong: current?.path ?? restorePath, outputDevice: outputId, ...prefs })
}

window.addEventListener('pagehide', flushSettings)

// ---------- favorites ----------

async function restoreFavorites(): Promise<void> {
  try {
    useMusic.setState({ favorites: await window.brita.loadFavorites() })
    favoritesReady = true
  } catch (error) {
    console.error('Loading the favorites failed', error)
  }
}

// ---------- play history ----------

async function restorePlays(): Promise<void> {
  try {
    useMusic.setState({ plays: await window.brita.loadHistory() })
    historyReady = true
  } catch (error) {
    console.error('Loading the play history failed', error)
  }
}

/** A new play of the song starts counting from zero (a new song, or the same song again). */
function startListening(): void {
  heard = 0
  counted = false
  lastTime = 0
}

/** Adds up the time really heard; once it is long enough the song counts as played, once. */
function listen(): void {
  const now = audio.currentTime
  if (!counted && !audio.paused) {
    heard += heardBetween(lastTime, now)
    const { current } = useMusic.getState()
    if (current !== null && heard >= secondsToCount(audio.duration)) countPlay(current.path)
  }
  lastTime = now
}

function countPlay(path: string): void {
  counted = true
  const plays = recordPlay(useMusic.getState().plays, path, Date.now())
  useMusic.setState({ plays })
  if (!historyReady) {
    console.error('The play history could not be loaded, so this play is not saved.')
    return
  }
  window.brita.saveHistory(plays)
}

// ---------- sound output ----------

/** The output the audio element really uses right now ('' is the system default). */
let sinkInUse = ''

/**
 * Sends the sound to an output. If Windows refuses (for example the device just vanished), the sound goes back
 * to the system default and the person is told why.
 */
async function switchOutput(id: string, failure: string): Promise<void> {
  try {
    await audio.setSinkId(id)
    sinkInUse = id
    useMusic.setState({ outputId: id })
  } catch (error) {
    console.error('Switching the sound output failed', error)
    await fallBackToDefault(failure)
  }
  saveSoon()
}

async function fallBackToDefault(message: string): Promise<void> {
  try {
    await audio.setSinkId('')
  } catch (error) {
    console.error('Going back to the default sound output failed', error)
  }
  sinkInUse = ''
  useMusic.setState({ outputId: '' })
  showNotice(message)
}

/** Looks at the connected outputs. A chosen output that is gone makes the sound return to the system default. */
async function refreshOutputs(): Promise<void> {
  let devices: MediaDeviceInfo[]
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch (error) {
    console.error('Could not list the sound outputs', error)
    return
  }
  const outputs = listOutputs(devices)
  useMusic.setState({ outputs })
  const wanted = useMusic.getState().outputId
  const { id, lost } = pickOutput(wanted, outputs)
  if (lost) {
    await fallBackToDefault('The chosen sound output is no longer connected. Playing through the system default.')
    saveSoon()
  } else if (id !== sinkInUse) {
    await switchOutput(id, 'The chosen sound output could not be used. Playing through the system default.')
  }
}

/** Reads the outputs now and again whenever a device is plugged in or removed. */
function watchOutputs(): void {
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshOutputs())
  void refreshOutputs()
}

// ---------- sleep timer ----------

const SLEEP_TICK_MS = 250
const FADE_STEP_MS = 50
let sleepTick: ReturnType<typeof setInterval> | undefined
let fadeTimer: ReturnType<typeof setInterval> | undefined
/** True while the sound fades out, so only then the volume is put back. */
let fading = false

/** Switches the timer off without touching the music. */
function clearSleep(): void {
  clearInterval(sleepTick)
  sleepTick = undefined
  useMusic.setState({ sleep: SLEEP_OFF, sleepLeft: 0 })
}

/** Counts down a timed sleep; when the time is up and music plays, the sound fades out and stops. */
function tickSleep(): void {
  const { sleep, sleepLeft } = useMusic.getState()
  if (sleep.kind !== 'time') {
    clearSleep()
    return
  }
  const left = secondsLeft(sleep.endsAt, Date.now())
  if (left > 0) {
    if (left !== sleepLeft) useMusic.setState({ sleepLeft: left })
    return
  }
  clearSleep()
  if (!audio.paused) startFade()
}

function startFade(): void {
  cancelFade()
  fading = true
  const began = performance.now()
  fadeTimer = setInterval(() => {
    const factor = fadeFactor(performance.now() - began, FADE_SECONDS)
    audio.volume = useMusic.getState().volume * factor
    if (factor > 0) return
    clearInterval(fadeTimer)
    fadeTimer = undefined
    audio.pause() // the "pause" event puts the volume back
    showNotice('Sleep timer: playback stopped.')
  }, FADE_STEP_MS)
}

/** Ends a fade and puts the volume back to what the person set. Does nothing when no fade runs. */
function cancelFade(): void {
  clearInterval(fadeTimer)
  fadeTimer = undefined
  if (!fading) return
  fading = false
  audio.volume = useMusic.getState().volume
}

/** "After this song": the song just ended, so nothing new starts. The next song waits, ready for the next press of Play. */
function stopAfterSong(): void {
  clearSleep()
  if (useMusic.getState().repeat !== 'one') {
    const song = step(1)
    if (song !== null) load(song, false, false)
  }
  showNotice('Sleep timer: playback stopped after the song.')
}

// ---------- queue and playback ----------

function setQueue(paths: string[], first: string | null): void {
  queue = paths
  order = useMusic.getState().shuffle ? shuffled(paths, first) : paths
}

/** After a restart the queue is empty: continue with the playlist of the loaded song. */
function ensureQueue(): void {
  const { current, library } = useMusic.getState()
  if (order.length > 0 || current === null) return
  const songs = current.playlist === null ? library.songs : library.songs.filter((song) => song.playlist === current.playlist)
  setQueue(songs.map((song) => song.path), current.path)
}

/** Tells the screen which songs play next. */
function publishUpcoming(): void {
  ensureQueue()
  const { current, library } = useMusic.getState()
  const paths = upcoming(order, current?.path ?? null)
  const byPath = new Map(library.songs.map((song) => [song.path, song]))
  const songs: Song[] = []
  for (const path of paths) {
    const song = byPath.get(path)
    if (song === undefined) continue // gone from the library: it is passed over
    songs.push(song)
    if (songs.length === QUEUE_SHOWN) break
  }
  useMusic.setState({ upcoming: songs, upcomingCount: paths.length })
}

/** The song after (1) or before (-1) the current one, or null at the end of the list. */
function step(direction: 1 | -1): Song | null {
  ensureQueue()
  const { current, repeat, library } = useMusic.getState()
  const byPath = new Map(library.songs.map((song) => [song.path, song]))
  let from = current?.path ?? null
  for (let tries = 0; tries < order.length; tries++) {
    const path = neighbour(order, from, direction, repeat)
    if (path === null) return null
    const song = byPath.get(path)
    if (song !== undefined) return song
    from = path // the file is gone from the library: pass over it
  }
  return null
}

function load(song: Song, play: boolean, byPlayer: boolean): void {
  automatic = byPlayer
  restorePath = null
  if (!byPlayer) {
    skips = 0
    showNotice(null)
  }
  useMusic.setState({ current: song, time: 0, duration: 0, playError: null })
  startListening()
  publishUpcoming()
  audio.src = window.brita.songUrl(song.path)
  if (play) startPlayback()
  saveSoon()
}

function startPlayback(): void {
  cancelFade()
  audio.play().catch((error: unknown) => {
    // A newer song interrupting this one is normal; a real failure also fires the "error" event.
    if (error instanceof DOMException && error.name === 'AbortError') return
    console.error('Playback failed', error)
  })
}

function showNotice(text: string | null): void {
  clearTimeout(noticeTimer)
  useMusic.setState({ notice: text })
  if (text !== null) noticeTimer = setTimeout(() => useMusic.setState({ notice: null }), NOTICE_SECONDS * 1000)
}

function stopPlayback(): void {
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  queue = []
  order = []
  useMusic.setState({ current: null, playing: false, time: 0, duration: 0, playError: null, upcoming: [], upcomingCount: 0 })
  saveSoon()
}

/** Things that depend on the library: a vanished view or song, and the song of the last session. */
function afterLibrary(library: Library): void {
  if (openNext !== null) {
    const wanted = openNext
    if (library.playlists.some((playlist) => playlist.key === wanted.key)) {
      openNext = null
      useMusic.setState({ view: wanted.key, query: '' })
    } else if (Date.now() > wanted.until) {
      openNext = null
    }
  }
  const { view, current } = useMusic.getState()
  if (view !== 'all' && !isAutomaticView(view) && !library.playlists.some((playlist) => playlist.key === view)) useMusic.setState({ view: 'all', query: '' })
  if (current !== null && !isInsideAny(current.path, library.folders)) stopPlayback()
  if (restorePath !== null && useMusic.getState().current === null) {
    const song = library.songs.find((item) => item.path === restorePath)
    if (song !== undefined) load(song, useMusic.getState().prefs.startPlaying, false)
  }
}

function isAutomaticView(view: View): boolean {
  return view === FAVORITES_VIEW || view === RECENT_VIEW || view === MOST_VIEW
}

function handleMediaKey(key: MediaKey): void {
  const state = useMusic.getState()
  if (key === 'play-pause') state.togglePlay()
  else if (key === 'next') state.next()
  else if (key === 'previous') state.previous()
  else audio.pause()
}

audio.addEventListener('play', () => useMusic.setState({ playing: true }))
audio.addEventListener('playing', () => { skips = 0 })
audio.addEventListener('pause', () => {
  cancelFade()
  useMusic.setState({ playing: false })
})
audio.addEventListener('timeupdate', () => {
  listen()
  useMusic.setState({ time: audio.currentTime })
})
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) useMusic.setState({ duration: audio.duration })
})

audio.addEventListener('ended', () => {
  useMusic.setState({ playing: false })
  if (useMusic.getState().sleep.kind === 'song') {
    stopAfterSong()
    return
  }
  if (useMusic.getState().repeat === 'one') {
    startListening()
    audio.currentTime = 0
    startPlayback()
    return
  }
  const song = step(1)
  if (song !== null) load(song, true, true)
})

audio.addEventListener('error', () => {
  const { current } = useMusic.getState()
  // A song the player came to by itself is passed over; one the person picked shows its message.
  if (automatic && current !== null && skips < Math.max(order.length, 1)) {
    const song = step(1)
    if (song !== null && song.path !== current.path) {
      skips++
      showNotice(`Skipped "${current.title}": it cannot be played.`)
      load(song, true, true)
      return
    }
  }
  const type = current === null ? 'this' : current.ext.toUpperCase()
  useMusic.setState({ playing: false, playError: `This song cannot be played. ${type} files may not be supported, or the file is damaged.` })
})

/** Every song of a list, in the order of the folders. */
// ---------- Windows media controls (volume flyout, lock screen) ----------

/** Tells Windows what plays, and lets its buttons and the keyboard media keys control the player. */
function connectMediaSession(): void {
  const session = navigator.mediaSession
  const handlers: Array<[MediaSessionAction, () => void]> = [
    ['play', () => { if (!useMusic.getState().playing) useMusic.getState().togglePlay() }],
    ['pause', () => audio.pause()],
    ['stop', () => audio.pause()],
    ['nexttrack', () => useMusic.getState().next()],
    ['previoustrack', () => useMusic.getState().previous()],
  ]
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler)
    } catch (error) {
      console.error(`The media session action ${action} is not supported`, error)
    }
  }
  useMusic.subscribe((state, before) => {
    if (state.current !== before.current) {
      const song = state.current
      session.metadata = song === null ? null : new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: song.album,
        artwork: [{ src: window.brita.coverUrl(song.path), sizes: '512x512' }],
      })
    }
    if (state.playing !== before.playing || state.current !== before.current) {
      session.playbackState = state.current === null ? 'none' : state.playing ? 'playing' : 'paused'
    }
  })
}

connectMediaSession()

// ---------- Tray menu ----------

/** The tray menu (main process) shows Play or Pause and the song's name, so it is told whenever either changes. */
useMusic.subscribe((state, before) => {
  if (state.playing === before.playing && state.current === before.current) return
  const song = state.current
  window.brita.reportPlayback({ playing: state.playing, song: song === null ? null : { title: song.title, artist: song.artist, path: song.path } })
})

export function songsInView(library: Library, view: View, favorites: readonly string[], plays: readonly Play[]): Song[] {
  if (view === 'all') return library.songs
  if (view === FAVORITES_VIEW) return onlyFavorites(library.songs, favorites)
  if (view === RECENT_VIEW) return recentSongs(library.songs, plays)
  if (view === MOST_VIEW) return mostPlayedSongs(library.songs, plays)
  return library.songs.filter((song) => song.playlist === view)
}

/** What the list on screen shows: the songs of the view that match the search, in the chosen sort order. */
export function visibleSongs(library: Library, view: View, favorites: readonly string[], plays: readonly Play[], query: string, sort: Sort): Song[] {
  return sortSongs(filterSongs(songsInView(library, view, favorites, plays), query), sort)
}
