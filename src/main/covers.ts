import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { locateSong } from './media.ts'
import { loadMusicMetadata } from './tags.ts'

export interface Cover {
  data: Uint8Array
  type: string
}

const FOLDER_IMAGE = /^(cover|folder|front|album|albumart)\.(jpe?g|png|webp)$/i
const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const KEEP_COVERS = 300

const remembered = new Map<string, Cover | null>()

async function embeddedCover(filePath: string): Promise<Cover | null> {
  try {
    const { parseFile, selectCover } = await loadMusicMetadata()
    const meta = await parseFile(filePath)
    const picture = selectCover(meta.common.picture)
    return picture ? { data: picture.data, type: picture.format } : null
  } catch {
    return null
  }
}

async function folderCover(filePath: string): Promise<Cover | null> {
  const dir = path.dirname(filePath)
  try {
    const name = (await readdir(dir)).find((entry) => FOLDER_IMAGE.test(entry))
    if (name === undefined) return null
    const ext = path.extname(name).slice(1).toLowerCase()
    return { data: await readFile(path.join(dir, name)), type: IMAGE_TYPES[ext] }
  } catch {
    return null
  }
}

/** The picture inside the song file, or else a cover image lying in the same folder. */
export async function findCover(filePath: string): Promise<Cover | null> {
  const key = filePath.toLowerCase()
  if (remembered.has(key)) return remembered.get(key) ?? null

  const cover = (await embeddedCover(filePath)) ?? (await folderCover(filePath))
  if (remembered.size >= KEEP_COVERS) remembered.delete(remembered.keys().next().value!)
  remembered.set(key, cover)
  return cover
}

export async function serveCover(request: Request, folders: () => string[]): Promise<Response> {
  const located = await locateSong(request, folders())
  if (located instanceof Response) return located
  const cover = await findCover(located.filePath)
  if (cover === null) return new Response('No cover', { status: 404 })
  return new Response(cover.data as BodyInit, {
    status: 200,
    headers: { 'Content-Type': cover.type, 'Cache-Control': 'private, max-age=300' },
  })
}
