import { Maximize2, Music, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PlaybackReport } from '../../shared/types'

const NOTHING: PlaybackReport = { playing: false, song: null }

/** The mini player's own picture of the player. The main window reports; this page never plays anything. */
function usePlayback(): PlaybackReport {
  const [report, setReport] = useState<PlaybackReport>(NOTHING)
  useEffect(() => {
    let pushed = false
    const stop = window.brita.onPlayback((next) => {
      pushed = true
      setReport(next)
    })
    // A report that arrived while the answer was on its way is newer than the answer.
    window.brita.playbackState().then(
      (first) => { if (!pushed) setReport(first) },
      (error: unknown) => console.error('Could not read the player state', error),
    )
    return stop
  }, [])
  return report
}

/** The song's cover; no picture (or a song without one) shows a note. */
function MiniCover({ path }: { path: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [path])
  return (
    <span className="mini-cover">
      {path === '' || failed ? (
        <Music className="i" aria-hidden />
      ) : (
        <img key={path} src={window.brita.coverUrl(path)} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  )
}

export function Mini() {
  const { playing, song } = usePlayback()
  const noSong = song === null

  return (
    <main className="mini">
      <MiniCover path={song?.path ?? ''} />
      <div className="mini-text">
        {song === null ? (
          <span className="mini-title dim">Nothing is playing</span>
        ) : (
          <span className="mini-title" title={song.title}>{song.title}</span>
        )}
        {song !== null && song.artist !== '' && <span className="mini-artist">{song.artist}</span>}
      </div>
      <div className="mini-controls">
        <button type="button" className="ctl" disabled={noSong} onClick={() => window.brita.controlPlayer('previous')} aria-label="Previous song" title="Previous song">
          <SkipBack className="i" aria-hidden />
        </button>
        <button
          type="button"
          className="play"
          disabled={noSong}
          onClick={() => window.brita.controlPlayer('play-pause')}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="i" aria-hidden /> : <Play className="i" aria-hidden />}
        </button>
        <button type="button" className="ctl" disabled={noSong} onClick={() => window.brita.controlPlayer('next')} aria-label="Next song" title="Next song">
          <SkipForward className="i" aria-hidden />
        </button>
      </div>
      <div className="mini-corner">
        <button type="button" className="icon-btn" onClick={() => window.brita.showMainWindow()} aria-label="Open Brita Music" title="Open Brita Music">
          <Maximize2 className="i" aria-hidden />
        </button>
        <button type="button" className="icon-btn" onClick={() => window.brita.closeMiniPlayer()} aria-label="Close the mini player" title="Close the mini player (the music goes on)">
          <X className="i" aria-hidden />
        </button>
      </div>
    </main>
  )
}
