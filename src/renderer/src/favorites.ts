/**
 * The view key of the automatic Favorites list. A colon cannot be part of a Windows folder name, so
 * no playlist can ever have this key.
 */
export const FAVORITES_VIEW = ':favorites'

/** The list with the song added, or removed if it was in it. The original list is not changed. */
export function toggled(favorites: readonly string[], path: string): string[] {
  return favorites.includes(path) ? favorites.filter((item) => item !== path) : [...favorites, path]
}

/** The songs that have a heart, in the order of the library. A heart on a song that is no longer in the library shows nothing. */
export function onlyFavorites<T extends { path: string }>(songs: readonly T[], favorites: readonly string[]): T[] {
  const hearts = new Set(favorites)
  return songs.filter((song) => hearts.has(song.path))
}
