import { constants } from 'node:fs'
import { copyFile, lstat, readdir, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { isInsideFolder } from './media.ts'
import { isMusicFile } from './scan.ts'
import type { DropResult } from '../shared/types.ts'

export const MAX_DROPPED = 2000

export interface Dropped {
  dirs: string[]
  files: string[]
  /** Items that could not be looked at (gone, no rights, or not a path). */
  unreadable: number
}

/** Sorts what was dropped into folders and files. Anything that is not an absolute path is counted as unreadable. */
export async function sortDropped(paths: unknown): Promise<Dropped> {
  const sorted: Dropped = { dirs: [], files: [], unreadable: 0 }
  if (!Array.isArray(paths)) return sorted
  for (const item of paths.slice(0, MAX_DROPPED)) {
    if (typeof item !== 'string' || !path.isAbsolute(item)) {
      sorted.unreadable++
      continue
    }
    try {
      const info = await stat(item)
      if (info.isDirectory()) sorted.dirs.push(path.normalize(item))
      else if (info.isFile()) sorted.files.push(path.normalize(item))
      else sorted.unreadable++
    } catch {
      sorted.unreadable++
    }
  }
  return sorted
}

/** Can this dropped folder become a music folder? Gives its real path, or a plain-words reason why not. */
export async function checkNewFolder(folders: string[], dropped: string): Promise<{ ok: true; folder: string } | { ok: false; message: string }> {
  let real: string
  try {
    real = await realpath(dropped)
  } catch {
    return { ok: false, message: `“${path.basename(dropped)}” could not be opened.` }
  }
  const name = path.basename(real) || real
  if (folders.some((folder) => folder.toLowerCase() === real.toLowerCase())) {
    return { ok: false, message: `“${name}” is already a music folder.` }
  }
  if (folders.some((folder) => isInsideFolder(real, folder))) {
    return { ok: false, message: `“${name}” is already inside a music folder.` }
  }
  return { ok: true, folder: real }
}

/** The folder of a playlist: the first music folder that holds a folder of that name. Null if none does. */
export async function playlistFolder(folders: string[], key: unknown): Promise<string | null> {
  if (typeof key !== 'string' || key === '') return null
  for (const root of folders) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    const found = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === key)
    if (found !== undefined) return path.join(root, found.name)
  }
  return null
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch {
    return false
  }
}

function copyProblem(error: unknown, name: string): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST') return `“${name}” is already in this playlist, so it was not copied.`
  if (code === 'ENOSPC') return `There is no space left on the drive for “${name}”.`
  if (code === 'EACCES' || code === 'EPERM') return `Windows does not allow copying “${name}” there.`
  if (code === 'ENOENT') return `“${name}” is gone or the playlist folder is gone.`
  return `“${name}” could not be copied.`
}

/**
 * Copies dropped music files into a playlist's folder. Nothing is moved, nothing is overwritten:
 * a name that already exists is skipped, and a copy that fails halfway is taken away again.
 */
export async function copyIntoPlaylist(target: string, files: string[]): Promise<{ copied: number; problems: string[] }> {
  const problems: string[] = []
  let copied = 0
  const notMusic: string[] = []

  for (const source of files) {
    const name = path.basename(source)
    if (!isMusicFile(name)) {
      notMusic.push(name)
      continue
    }
    const destination = path.join(target, name)
    const existedBefore = await exists(destination)
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL)
      copied++
    } catch (error) {
      problems.push(copyProblem(error, name))
      const code = (error as NodeJS.ErrnoException).code
      // Only the half-written copy this run made is removed, never a file that was already there.
      if (code !== 'EEXIST' && !existedBefore && (await exists(destination))) {
        await rm(destination, { force: true }).catch(() => undefined)
      }
    }
  }

  if (notMusic.length === 1) problems.push(`“${notMusic[0]}” is not a music file, so it was not copied.`)
  else if (notMusic.length > 1) problems.push(`${notMusic.length} files are not music files, so they were not copied.`)
  return { copied, problems }
}

function summary(added: number, copied: number, problems: string[]): string | null {
  const parts: string[] = []
  if (added > 0) parts.push(added === 1 ? 'Music folder added.' : `${added} music folders added.`)
  if (copied > 0) parts.push(copied === 1 ? '1 song copied.' : `${copied} songs copied.`)
  if (problems.length > 0) parts.push(problems.slice(0, 2).join(' '))
  if (problems.length > 2) parts.push(`And ${problems.length - 2} more problems.`)
  return parts.length === 0 ? null : parts.join(' ')
}

/**
 * Handles one drop on the window. With a `playlist` (its key) the dropped songs are copied into that playlist's
 * folder; without one, dropped folders become music folders. `addFolder` is called for each new music folder.
 */
export async function handleDrop(
  folders: string[],
  paths: unknown,
  playlist: unknown,
  addFolder: (folder: string) => Promise<void>,
): Promise<DropResult> {
  const problems: string[] = []
  let added = 0
  let copied = 0
  const dropped = await sortDropped(paths)
  if (dropped.unreadable > 0) problems.push(dropped.unreadable === 1 ? 'One item could not be read.' : `${dropped.unreadable} items could not be read.`)

  if (typeof playlist === 'string') {
    const target = await playlistFolder(folders, playlist)
    if (target === null) problems.push('That playlist folder cannot be found.')
    else if (dropped.dirs.length > 0) problems.push('Folders cannot be copied into a playlist. Drop a folder on the empty part of the window to add it as a music folder.')
    else if (dropped.files.length > 0) {
      const done = await copyIntoPlaylist(target, dropped.files)
      copied = done.copied
      problems.push(...done.problems)
    }
  } else {
    let known = folders
    for (const dir of dropped.dirs) {
      const check = await checkNewFolder(known, dir)
      if (!check.ok) {
        problems.push(check.message)
        continue
      }
      await addFolder(check.folder)
      known = [...known, check.folder]
      added++
    }
    if (dropped.files.length > 0) problems.push('To copy songs, drop them onto a playlist in the sidebar.')
  }
  return { added, copied, message: summary(added, copied, problems) }
}
