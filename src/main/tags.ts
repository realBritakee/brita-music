import path from 'node:path'
import type { Details } from '../shared/types.ts'
import { fileNameDetails } from './scan.ts'

// music-metadata is an ES module; loading it on first use works from the built (CommonJS) app and from tests.
let loader: Promise<typeof import('music-metadata')> | null = null

export function loadMusicMetadata(): Promise<typeof import('music-metadata')> {
  loader ??= import('music-metadata')
  return loader
}

// Ogg files only tell their length on their last page, so the reader must follow the file to its end.
// That is cheap for Ogg and slow for other formats, which is why it is not switched on for everything.
const NEEDS_END_OF_FILE = new Set(['.ogg', '.oga', '.opus'])

function cleaned(text: string | undefined): string {
  return text === undefined ? '' : text.trim()
}

/** Reads title, artist, album and length. A file that cannot be read keeps its file name as title. */
export async function readDetails(filePath: string): Promise<Details> {
  const fallback = fileNameDetails(filePath)
  try {
    const { parseFile } = await loadMusicMetadata()
    const duration = NEEDS_END_OF_FILE.has(path.extname(filePath).toLowerCase())
    const meta = await parseFile(filePath, { skipCovers: true, duration })
    const length = meta.format.duration
    return {
      title: cleaned(meta.common.title) || fallback.title,
      artist: cleaned(meta.common.artist) || cleaned(meta.common.albumartist),
      album: cleaned(meta.common.album),
      duration: length !== undefined && Number.isFinite(length) && length > 0 ? length : null,
    }
  } catch {
    return fallback
  }
}
