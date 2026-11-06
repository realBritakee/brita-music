import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Details, Library, Playlist, Song } from '../shared/types.ts'

export const MUSIC_EXTENSIONS = new Set([
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'ape', 'aif', 'aiff',
])

const SYSTEM_FOLDERS = new Set(['$recycle.bin', 'system volume information'])

export interface FolderScan {
  root: string
  playlists: string[]
  songs: Song[]
  unreadable: string[]
  /** True if the music folder itself does not exist (for example an unplugged drive). */
  missing: boolean
}

function isSystemFolder(name: string): boolean {
  return SYSTEM_FOLDERS.has(name.toLowerCase())
}

export function isMusicFile(fileName: string): boolean {
  return MUSIC_EXTENSIONS.has(path.extname(fileName).slice(1).toLowerCase())
}

/** What is known before any tag is read: the file name stands in for the title. */
export function fileNameDetails(filePath: string): Details {
  return { title: path.basename(filePath, path.extname(filePath)), artist: '', album: '', duration: null }
}

function toSong(filePath: string, playlist: string | null): Song {
  return {
    ...fileNameDetails(filePath),
    path: filePath,
    ext: path.extname(filePath).slice(1).toLowerCase(),
    playlist,
  }
}

/** True for the errors Windows gives for a folder or drive that is not there. */
function isGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Reads one music folder. Only folders directly inside it become playlists. */
export async function scanFolder(root: string): Promise<FolderScan> {
  const scan: FolderScan = { root, playlists: [], songs: [], unreadable: [], missing: false }
  const pending: Array<{ dir: string; playlist: string | null }> = [{ dir: root, playlist: null }]

  while (pending.length > 0) {
    const { dir, playlist } = pending.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (dir === root && isGone(error)) scan.missing = true
      else scan.unreadable.push(dir)
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && !isSystemFolder(entry.name)) {
        const owner = playlist ?? entry.name
        if (playlist === null) scan.playlists.push(entry.name)
        pending.push({ dir: full, playlist: owner })
      } else if (entry.isFile() && isMusicFile(entry.name)) {
        scan.songs.push(toSong(full, playlist))
      }
    }
  }
  return scan
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Joins the scans of all music folders into the one library the app shows. */
export function buildLibrary(scans: FolderScan[]): Library {
  const playlists = new Map<string, Playlist>()
  const songs = new Map<string, Song>()

  for (const scan of scans) {
    for (const name of scan.playlists) {
      const key = name.toLowerCase()
      if (!playlists.has(key)) playlists.set(key, { key, name })
    }
    for (const song of scan.songs) {
      const id = song.path.toLowerCase()
      const playlist = song.playlist === null ? null : song.playlist.toLowerCase()
      if (!songs.has(id)) songs.set(id, { ...song, playlist })
    }
  }

  return {
    folders: scans.map((scan) => scan.root),
    playlists: [...playlists.values()].sort((a, b) => byName.compare(a.name, b.name)),
    songs: [...songs.values()].sort((a, b) => byName.compare(a.path, b.path)),
    unreadable: scans.flatMap((scan) => scan.unreadable),
    missing: scans.filter((scan) => scan.missing).map((scan) => scan.root),
  }
}
