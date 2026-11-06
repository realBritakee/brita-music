import type { RepeatMode } from '../../shared/types'

/** A random order of the paths. The `first` path, if given, comes first. */
export function shuffled(paths: string[], first: string | null, random: () => number = Math.random): string[] {
  const rest = paths.filter((item) => item !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return first !== null && paths.includes(first) ? [first, ...rest] : rest
}

/**
 * The path that plays after (direction 1) or before (direction -1) the current one, or null when the
 * list has ended. With repeat on, the list wraps around. A current song that is not in the list
 * counts as "before the first".
 */
export function neighbour(order: string[], current: string | null, direction: 1 | -1, repeat: RepeatMode): string | null {
  if (order.length === 0) return null
  const index = current === null ? -1 : order.indexOf(current)
  if (index === -1) return direction === 1 ? order[0] : null
  const target = index + direction
  if (target >= 0 && target < order.length) return order[target]
  if (repeat === 'off') return null
  return direction === 1 ? order[0] : order[order.length - 1]
}

/** The list without the path. */
export function without(list: string[], path: string): string[] {
  return list.filter((item) => item !== path)
}

/** The list with the path moved (or added) right after `anchor`. An anchor that is not in the list puts it first. */
export function placeAfter(list: string[], path: string, anchor: string | null): string[] {
  const rest = without(list, path)
  const at = anchor === null ? -1 : rest.indexOf(anchor)
  rest.splice(at + 1, 0, path)
  return rest
}

/** The list with the path moved (or added) to the very end. */
export function placeLast(list: string[], path: string): string[] {
  return [...without(list, path), path]
}

/** The paths that play after the current one, in play order. Nothing is playing: nothing is next. */
export function upcoming(order: string[], current: string | null): string[] {
  if (current === null) return []
  return order.slice(order.indexOf(current) + 1)
}

/** True if the file lies inside one of the folders (Windows paths compare without case). */
export function isInsideAny(filePath: string, folders: string[]): boolean {
  const file = filePath.replaceAll('\\', '/').toLowerCase()
  return folders.some((folder) => {
    const base = folder.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '')
    return file.startsWith(`${base}/`)
  })
}

/** A short name for each music folder: its last part, or the whole path when two folders end alike. */
export function folderLabels(folders: string[]): string[] {
  const last = (folder: string) => folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder
  const counts = new Map<string, number>()
  for (const folder of folders) counts.set(last(folder).toLowerCase(), (counts.get(last(folder).toLowerCase()) ?? 0) + 1)
  return folders.map((folder) => ((counts.get(last(folder).toLowerCase()) ?? 0) > 1 ? folder : last(folder)))
}
