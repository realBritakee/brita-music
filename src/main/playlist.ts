import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { CreateResult } from '../shared/types.ts'

const MAX_NAME_LENGTH = 100
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const HIDDEN_FOLDERS = new Set(['$recycle.bin', 'system volume information'])

/** Why Windows would not accept this as a folder name, in plain words, or null if it is fine. */
export function nameProblem(name: string): string | null {
  if (name === '') return 'Type a name for the playlist.'
  if (name.length > MAX_NAME_LENGTH) return `The name is too long. Use at most ${MAX_NAME_LENGTH} characters.`
  if (FORBIDDEN_CHARACTERS.test(name)) return 'A name cannot contain any of these: \\ / : * ? " < > |'
  if (name.endsWith('.') || name.endsWith(' ')) return 'A name cannot end with a dot or a space.'
  if (RESERVED_NAMES.test(name) || HIDDEN_FOLDERS.has(name.toLowerCase())) return 'Windows does not allow that name. Try another one.'
  return null
}

async function namesIn(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).map((name) => name.toLowerCase())
  } catch {
    return []
  }
}

function errorMessage(error: unknown, name: string): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return `“${name}” already exists.`
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'That music folder cannot be found. Is the drive connected?'
  if (code === 'EACCES' || code === 'EPERM') return 'Windows does not allow creating a folder there.'
  if (code === 'ENOSPC') return 'There is no space left on that drive.'
  return 'The playlist could not be created.'
}

/**
 * Makes a new, empty folder inside one of the music folders. The folder is a playlist as soon as it exists.
 * `folders` are the music folders the app knows; nothing outside them is ever touched.
 */
export async function createPlaylist(folders: string[], folder: unknown, rawName: unknown): Promise<CreateResult> {
  if (typeof folder !== 'string' || typeof rawName !== 'string') return { ok: false, message: 'The playlist could not be created.' }
  const root = folders.find((item) => item.toLowerCase() === folder.toLowerCase())
  if (root === undefined) return { ok: false, message: 'That music folder is not in Brita Music.' }

  const name = rawName.trim()
  const problem = nameProblem(name)
  if (problem !== null) return { ok: false, message: problem }

  // The same name in any music folder is the same playlist, so it counts as taken.
  const key = name.toLowerCase()
  for (const other of folders) {
    if ((await namesIn(other)).includes(key)) return { ok: false, message: `“${name}” already exists.` }
  }

  try {
    await mkdir(path.join(root, name))
  } catch (error) {
    return { ok: false, message: errorMessage(error, name) }
  }
  return { ok: true, name }
}
