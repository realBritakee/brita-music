import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { isMusicFile } from './scan.ts'

export const MEDIA_SCHEME = 'brita-media'

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
}

export interface ByteRange {
  start: number
  end: number
}

/** Reads a "bytes=start-end" header. Returns null if the header asks for an impossible range. */
export function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null

  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix === 0) return null
    return { start: Math.max(size - suffix, 0), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start >= size || start > end) return null
  return { start, end }
}

export function isInsideFolder(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function bodyOf(filePath: string, range: ByteRange): BodyInit {
  return Readable.toWeb(createReadStream(filePath, range)) as unknown as BodyInit
}

/**
 * Finds the song a request asks for. Only music files inside the added folders are allowed;
 * anything else gets the error response to send back.
 */
export async function locateSong(request: Request, folders: string[]): Promise<{ filePath: string; size: number } | Response> {
  const requested = decodeURIComponent(new URL(request.url).pathname.slice(1))

  let filePath: string
  let size: number
  try {
    filePath = await realpath(requested)
    size = (await stat(filePath)).size
  } catch {
    return new Response('Song not found', { status: 404 })
  }

  const allowed = isMusicFile(filePath) && folders.some((folder) => isInsideFolder(filePath, folder))
  if (!allowed) return new Response('Not allowed', { status: 403 })
  return { filePath, size }
}

/** Answers the player's requests for a song. It supports byte ranges, because the seek bar depends on them. */
export async function serveSong(request: Request, folders: () => string[]): Promise<Response> {
  const located = await locateSong(request, folders())
  if (located instanceof Response) return located
  const { filePath, size } = located

  const ext = path.extname(filePath).slice(1).toLowerCase()
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
  })
  if (size === 0) return new Response(null, { status: 200, headers })

  const rangeHeader = request.headers.get('range')
  if (rangeHeader === null) {
    headers.set('Content-Length', String(size))
    return new Response(bodyOf(filePath, { start: 0, end: size - 1 }), { status: 200, headers })
  }

  const range = parseRange(rangeHeader, size)
  if (range === null) {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  headers.set('Content-Length', String(range.end - range.start + 1))
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  return new Response(bodyOf(filePath, range), { status: 206, headers })
}
