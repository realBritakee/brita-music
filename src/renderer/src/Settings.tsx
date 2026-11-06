import { useEffect, useState } from 'react'
import { Download, FolderMinus, FolderPlus, RefreshCw, RotateCw, Settings as SettingsIcon } from 'lucide-react'
import { RESTART_CHOICES } from '../../shared/choices'
import type { RepeatAtStart, ShuffleAtStart } from '../../shared/types'
import { folderLabels } from './queue'
import { useMusic } from './store'

export function AddFolderButton({ primary }: { primary: boolean }) {
  const addFolder = useMusic((state) => state.addFolder)
  const loading = useMusic((state) => state.loading)
  const kind = primary ? 'btn-primary' : 'btn-secondary'
  return (
    <button type="button" className={`btn ${kind}`} onClick={() => void addFolder()} disabled={loading}>
      <FolderPlus className="i" aria-hidden />
      {loading ? 'Reading folder' : 'Add folder'}
    </button>
  )
}

/** The added music folders, each with a button that makes the app forget it. The files stay on the PC. */
function FolderList() {
  const folders = useMusic((state) => state.library.folders)
  const missing = useMusic((state) => state.library.missing)
  const removeFolder = useMusic((state) => state.removeFolder)
  const [asking, setAsking] = useState<string | null>(null)
  if (folders.length === 0) return <p className="muted">No music folder yet.</p>
  const labels = folderLabels(folders)

  return (
    <ul className="folder-list">
      {folders.map((folder, index) => (
        <li key={folder} className="folder">
          {asking === folder ? (
            <>
              <p className="folder-ask">Remove “{labels[index]}” from Brita Music? Your files stay where they are.</p>
              <div className="folder-buttons">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => { setAsking(null); void removeFolder(folder) }}>Remove</button>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setAsking(null)}>Keep</button>
              </div>
            </>
          ) : (
            <>
              <span className="folder-name" title={folder}>{labels[index]}</span>
              {missing.includes(folder) && <span className="badge warn" title="This folder cannot be found right now.">Not found</span>}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove folder ${labels[index]}`}
                title="Remove this folder from Brita Music"
                onClick={() => setAsking(folder)}
              >
                <FolderMinus className="i" aria-hidden />
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

interface Option {
  value: string
  label: string
}

/** A labelled list of choices. The label sits above the list. */
function ChoiceField({ id, label, hint, value, options, onChange }: {
  id: string
  label: string
  hint: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <p className="field-hint">{hint}</p>
    </div>
  )
}

const START_OPTIONS: Option[] = [
  { value: 'paused', label: 'Wait until I press play' },
  { value: 'playing', label: 'Continue with the last song' },
]
const RESTART_OPTIONS: Option[] = RESTART_CHOICES.map((seconds) => ({
  value: String(seconds),
  label: seconds === 0 ? 'Never, always go to the previous song' : `${seconds} seconds`,
}))
const SHUFFLE_OPTIONS: Option[] = [
  { value: 'remember', label: 'Like last time' },
  { value: 'on', label: 'Always on' },
  { value: 'off', label: 'Always off' },
]
const REPEAT_OPTIONS: Option[] = [
  { value: 'remember', label: 'Like last time' },
  { value: 'off', label: 'Off' },
  { value: 'all', label: 'Repeat the whole list' },
  { value: 'one', label: 'Repeat one song' },
]

const CLOSE_OPTIONS: Option[] = [
  { value: 'quit', label: 'Quit Brita Music' },
  { value: 'tray', label: 'Keep playing in the tray' },
]

function PlaybackSettings() {
  const prefs = useMusic((state) => state.prefs)
  const setPreference = useMusic((state) => state.setPreference)
  return (
    <section className="panel" aria-labelledby="settings-playback">
      <h2 id="settings-playback">Playback</h2>
      <ChoiceField
        id="setting-start"
        label="When Brita Music starts"
        hint="It always loads the song you listened to last."
        value={prefs.startPlaying ? 'playing' : 'paused'}
        options={START_OPTIONS}
        onChange={(value) => setPreference('startPlaying', value === 'playing')}
      />
      <ChoiceField
        id="setting-restart"
        label="The previous button restarts a song after"
        hint="Before that time it goes back one song."
        value={String(prefs.restartAfter)}
        options={RESTART_OPTIONS}
        onChange={(value) => setPreference('restartAfter', Number(value))}
      />
      <ChoiceField
        id="setting-shuffle"
        label="Shuffle at start"
        hint="“Like last time” keeps what you used when you closed the app."
        value={prefs.shuffleAtStart}
        options={SHUFFLE_OPTIONS}
        onChange={(value) => setPreference('shuffleAtStart', value as ShuffleAtStart)}
      />
      <ChoiceField
        id="setting-repeat"
        label="Repeat at start"
        hint="“Like last time” keeps what you used when you closed the app."
        value={prefs.repeatAtStart}
        options={REPEAT_OPTIONS}
        onChange={(value) => setPreference('repeatAtStart', value as RepeatAtStart)}
      />
      <ChoiceField
        id="setting-close"
        label="When I close the window"
        hint="In the tray, the music keeps playing and an icon near the clock opens the window again. Windows may hide the icon under the small arrow."
        value={prefs.closeToTray ? 'tray' : 'quit'}
        options={CLOSE_OPTIONS}
        onChange={(value) => setPreference('closeToTray', value === 'tray')}
      />
    </section>
  )
}

function FolderSettings() {
  const libraryError = useMusic((state) => state.libraryError)
  return (
    <section className="panel" aria-labelledby="settings-folders">
      <h2 id="settings-folders">Music folders</h2>
      <p className="muted">Every folder inside a music folder becomes a playlist. Removing a music folder only makes Brita Music forget it, your files stay where they are.</p>
      {libraryError !== null && <p className="message err" role="alert">{libraryError}</p>}
      <FolderList />
      <AddFolderButton primary={false} />
    </section>
  )
}

/** The text and button the person sees for each step of an update. Used by the banner and the settings page. */
export function UpdateActions({ small }: { small: boolean }) {
  const update = useMusic((state) => state.update)
  const downloadUpdate = useMusic((state) => state.downloadUpdate)
  const installUpdate = useMusic((state) => state.installUpdate)
  const size = small ? 'btn-small' : ''
  if (update.kind === 'available') {
    return (
      <button type="button" className={`btn btn-primary ${size}`} onClick={() => void downloadUpdate()}>
        <Download className="i" aria-hidden />
        {update.problem === undefined ? 'Update' : 'Try again'}
      </button>
    )
  }
  if (update.kind === 'ready') {
    return (
      <button type="button" className={`btn btn-primary ${size}`} onClick={() => void installUpdate()}>
        <RotateCw className="i" aria-hidden />
        Restart now
      </button>
    )
  }
  return null
}

/** One plain sentence about where the update stands; empty when there is nothing to say. */
export function updateText(update: ReturnType<typeof useMusic.getState>['update']): string {
  switch (update.kind) {
    case 'checking': return 'Looking for updates.'
    case 'none': return 'You have the latest version.'
    case 'available': return `Version ${update.version} is available. Download and restart?`
    case 'downloading': return `Downloading version ${update.version}, ${update.percent} percent.`
    case 'ready': return `Version ${update.version} is ready. Restart to install it.`
    case 'error': return update.message
    default: return ''
  }
}

function UpdateSettings() {
  const update = useMusic((state) => state.update)
  const checkForUpdates = useMusic((state) => state.checkForUpdates)
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    window.brita.appVersion().then(setVersion).catch((error: unknown) => console.error('Could not read the version', error))
  }, [])
  const working = update.kind === 'checking' || update.kind === 'downloading' || update.kind === 'ready'
  const text = update.kind === 'error' ? '' : updateText(update)
  const problem = update.kind === 'error' ? update.message : update.kind === 'available' ? update.problem : undefined
  return (
    <section className="panel" aria-labelledby="settings-update">
      <h2 id="settings-update">Updates</h2>
      <p className="muted">{version === null ? 'Brita Music' : `Brita Music ${version}`}. It looks for a new version when it starts and always asks before it downloads anything.</p>
      {text !== '' && <p className="update-text" role="status">{text}</p>}
      {problem !== undefined && <p className="message err" role="alert">{problem}</p>}
      {update.kind === 'downloading' && <progress className="update-progress" max={100} value={update.percent} aria-label="Download progress" />}
      <div className="folder-buttons">
        <UpdateActions small={false} />
        <button type="button" className="btn btn-secondary" onClick={() => void checkForUpdates()} disabled={working}>
          <RefreshCw className="i" aria-hidden />
          Check for updates
        </button>
      </div>
    </section>
  )
}

function DataSettings() {
  const [folder, setFolder] = useState<string | null>(null)
  useEffect(() => {
    window.brita.dataFolder().then(setFolder).catch((error: unknown) => console.error('Could not read the data folder', error))
  }, [])
  return (
    <section className="panel" aria-labelledby="settings-data">
      <h2 id="settings-data">Your data</h2>
      <p className="muted">Brita Music keeps its own notes here: the list of your songs, these settings and the window position. Your music files are never copied or changed.</p>
      {folder !== null && <p className="data-path">{folder}</p>}
    </section>
  )
}

export function SettingsPage() {
  return (
    <div className="settings">
      <header className="view-head">
        <span className="head-cover"><SettingsIcon className="i" aria-hidden /></span>
        <div className="head-text">
          <h1>Settings</h1>
          <p className="muted">Changes are saved at once.</p>
        </div>
      </header>
      <div className="settings-body">
        <PlaybackSettings />
        <FolderSettings />
        <UpdateSettings />
        <DataSettings />
      </div>
    </div>
  )
}
