import type { Song } from '../../shared/types'

/** The columns a list can be sorted by. */
export type SortKey = 'title' | 'artist' | 'album' | 'length'

/** Which column, and which way. `null` means the order of the folders. */
export type Sort = { key: SortKey; descending: boolean } | null

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Lower case, without accents, so "bjork" finds "Björk". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Songs where every word of the query appears in the title, artist or album. An empty query keeps all songs. */
export function filterSongs(songs: Song[], query: string): Song[] {
  const words = normalize(query).split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return songs
  return songs.filter((song) => {
    const text = normalize(`${song.title} ${song.artist} ${song.album}`)
    return words.every((word) => text.includes(word))
  })
}

/** The next click on a column title: first A to Z, then Z to A, then back to the folder order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current === null || current.key !== key) return { key, descending: false }
  return current.descending ? null : { key, descending: true }
}

/** Compares two songs on one column; a missing value (empty text, unknown length) is null. */
function value(song: Song, key: SortKey): string | number | null {
  if (key === 'length') return song.duration
  const text = song[key]
  return text === '' ? null : text
}

/** A sorted copy. Missing values come last in both directions; songs that tie keep their folder order. */
export function sortSongs(songs: Song[], sort: Sort): Song[] {
  if (sort === null) return songs
  const direction = sort.descending ? -1 : 1
  return songs
    .map((song, index) => ({ song, index }))
    .sort((a, b) => {
      const left = value(a.song, sort.key)
      const right = value(b.song, sort.key)
      if (left === null || right === null) {
        if (left === right) return a.index - b.index
        return left === null ? 1 : -1
      }
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
      return order !== 0 ? order * direction : a.index - b.index
    })
    .map((entry) => entry.song)
}
