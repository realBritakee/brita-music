import { stat } from 'node:fs/promises'
import path from 'node:path'
import { isInsideFolder } from './media.ts'
import { isMusicFile } from './scan.ts'

/** True if the value is the path of a music file inside one of the added folders. Nothing else is acted on. */
export function isSongPath(file: unknown, folders: string[]): file is string {
  if (typeof file !== 'string' || file === '' || !path.isAbsolute(file)) return false
  return isMusicFile(file) && folders.some((folder) => isInsideFolder(path.resolve(file), folder))
}

/** The song's path if it is allowed and the file still exists, otherwise null. */
export async function findSong(file: unknown, folders: string[]): Promise<string | null> {
  if (!isSongPath(file, folders)) return null
  try {
    return (await stat(file)).isFile() ? path.normalize(file) : null
  } catch {
    return null
  }
}
