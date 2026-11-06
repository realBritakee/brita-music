import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeSettings } from '../src/main/persist.ts'
import { repeatAtStart, restartsSong, shuffleAtStart } from '../src/renderer/src/prefs.ts'
import { folderLabels, isInsideAny, neighbour, placeAfter, placeLast, shuffled, upcoming, without } from '../src/renderer/src/queue.ts'

const list = ['a', 'b', 'c']

test('next and previous move through the list', () => {
  assert.equal(neighbour(list, 'a', 1, 'off'), 'b')
  assert.equal(neighbour(list, 'c', -1, 'off'), 'b')
})

test('at the end, repeat off stops and repeat all wraps around', () => {
  assert.equal(neighbour(list, 'c', 1, 'off'), null)
  assert.equal(neighbour(list, 'c', 1, 'all'), 'a')
  assert.equal(neighbour(list, 'a', -1, 'off'), null)
  assert.equal(neighbour(list, 'a', -1, 'all'), 'c')
})

test('a song that is not in the list starts at the top; an empty list gives nothing', () => {
  assert.equal(neighbour(list, 'zzz', 1, 'off'), 'a')
  assert.equal(neighbour(list, null, 1, 'off'), 'a')
  assert.equal(neighbour([], 'a', 1, 'all'), null)
})

test('shuffle keeps every song once and puts the chosen one first', () => {
  const paths = Array.from({ length: 50 }, (_, i) => `song${i}`)
  const mixed = shuffled(paths, 'song7')
  assert.equal(mixed[0], 'song7')
  assert.deepEqual([...mixed].sort(), [...paths].sort())
  assert.notDeepEqual(mixed, paths)
})

test('shuffle with a fixed random source is repeatable, and an unknown first song is ignored', () => {
  const same = () => 0.5
  assert.deepEqual(shuffled(['a', 'b', 'c', 'd'], 'a', same), shuffled(['a', 'b', 'c', 'd'], 'a', same))
  assert.deepEqual([...shuffled(['a', 'b'], 'nope')].sort(), ['a', 'b'])
})

test('upcoming lists what plays after the current song, in play order', () => {
  assert.deepEqual(upcoming(['a', 'b', 'c', 'd'], 'b'), ['c', 'd'])
  assert.deepEqual(upcoming(['a', 'b'], 'b'), [])
  assert.deepEqual(upcoming(['a', 'b'], null), [])
  assert.deepEqual(upcoming(['a', 'b'], 'zzz'), ['a', 'b'])
})

test('with shuffle on, upcoming is exactly the order the songs then play in', () => {
  const paths = Array.from({ length: 30 }, (_, i) => `song${i}`)
  const order = shuffled(paths, 'song4')
  const shown = upcoming(order, 'song4')
  const played: string[] = []
  let at: string | null = 'song4'
  for (;;) {
    at = neighbour(order, at, 1, 'off')
    if (at === null) break
    played.push(at)
  }
  assert.deepEqual(shown, played)
  assert.equal(shown.length, 29)
})

test('removing a song takes it out of the order, so it is skipped', () => {
  const order = ['a', 'b', 'c', 'd']
  const after = without(order, 'c')
  assert.deepEqual(after, ['a', 'b', 'd'])
  assert.equal(neighbour(after, 'b', 1, 'off'), 'd')
  assert.deepEqual(without(order, 'zzz'), order)
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], 'the original list is not changed')
})

test('"play next" puts a song right after the current one and keeps every song once', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(placeAfter(order, 'e', 'b'), ['a', 'b', 'e', 'c', 'd'])
  assert.deepEqual(placeAfter(order, 'a', 'c'), ['b', 'c', 'a', 'd', 'e'])
  assert.deepEqual(placeAfter(order, 'c', 'b'), order)
  assert.deepEqual(placeAfter(order, 'new', 'b'), ['a', 'b', 'new', 'c', 'd', 'e'])
  assert.equal(neighbour(placeAfter(order, 'e', 'b'), 'b', 1, 'off'), 'e')
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'e'], 'the original list is not changed')
})

test('"play next" with no known anchor puts the song first', () => {
  assert.deepEqual(placeAfter(['a', 'b'], 'b', null), ['b', 'a'])
  assert.deepEqual(placeAfter(['a', 'b'], 'x', 'zzz'), ['x', 'a', 'b'])
})

test('a file is inside a folder only below it, without regard to case or slash type', () => {
  assert.equal(isInsideAny('D:\\Musik\\Rock\\a.mp3', ['d:/musik']), true)
  assert.equal(isInsideAny('D:\\Musik2\\a.mp3', ['D:\\Musik']), false)
  assert.equal(isInsideAny('D:\\Musik\\a.mp3', ['D:\\Musik\\']), true)
  assert.equal(isInsideAny('D:\\Musik\\a.mp3', []), false)
})

test('folder labels use the last part, or the whole path when two folders end alike', () => {
  assert.deepEqual(folderLabels(['D:\\Musik', 'E:\\Jazz']), ['Musik', 'Jazz'])
  assert.deepEqual(folderLabels(['D:\\Music', 'E:\\music']), ['D:\\Music', 'E:\\music'])
  assert.deepEqual(folderLabels(['D:\\']), ['D:'])
})

const CHOICES = { outputDevice: '', startPlaying: false, restartAfter: 3, shuffleAtStart: 'remember', repeatAtStart: 'remember', closeToTray: false }

test('settings: wrong or missing values fall back, good values stay', () => {
  assert.deepEqual(sanitizeSettings(null), { volume: 1, muted: false, shuffle: false, repeat: 'off', lastSong: null, ...CHOICES })
  assert.deepEqual(
    sanitizeSettings({ volume: 0.25, muted: true, shuffle: true, repeat: 'one', lastSong: 'D:\\Musik\\a.mp3' }),
    { volume: 0.25, muted: true, shuffle: true, repeat: 'one', lastSong: 'D:\\Musik\\a.mp3', ...CHOICES },
  )
  assert.deepEqual(
    sanitizeSettings({ volume: 7, muted: 'yes', shuffle: 1, repeat: 'sometimes', lastSong: '' }),
    { volume: 1, muted: false, shuffle: false, repeat: 'off', lastSong: null, ...CHOICES },
  )
  assert.equal(sanitizeSettings({ volume: -3 }).volume, 0)
  assert.equal(sanitizeSettings({ volume: Number.NaN }).volume, 1)
})

test('settings: the choices on the settings page are kept, and wrong ones fall back', () => {
  const chosen = { startPlaying: true, restartAfter: 0, shuffleAtStart: 'on', repeatAtStart: 'one', closeToTray: true }
  assert.deepEqual(sanitizeSettings(chosen), { volume: 1, muted: false, shuffle: false, repeat: 'off', lastSong: null, outputDevice: '', ...chosen })
  assert.equal(sanitizeSettings({ restartAfter: 10 }).restartAfter, 10)
  assert.equal(sanitizeSettings({ restartAfter: 7 }).restartAfter, 3)
  assert.equal(sanitizeSettings({ restartAfter: '5' }).restartAfter, 3)
  assert.equal(sanitizeSettings({ startPlaying: 'yes' }).startPlaying, false)
  assert.equal(sanitizeSettings({ closeToTray: 'yes' }).closeToTray, false)
  assert.equal(sanitizeSettings({}).closeToTray, false)
  assert.equal(sanitizeSettings({ shuffleAtStart: 'sometimes' }).shuffleAtStart, 'remember')
  assert.equal(sanitizeSettings({ repeatAtStart: 'on' }).repeatAtStart, 'remember')
})

test('settings: a file from before the settings page keeps its values and gets the default choices', () => {
  const old = { volume: 0.3, muted: false, shuffle: true, repeat: 'all', lastSong: 'D:\\Musik\\a.mp3' }
  assert.deepEqual(sanitizeSettings(old), { ...old, ...CHOICES })
})

test('shuffle and repeat at start: "like last time" keeps what was used, otherwise the fixed choice wins', () => {
  assert.equal(shuffleAtStart('remember', true), true)
  assert.equal(shuffleAtStart('remember', false), false)
  assert.equal(shuffleAtStart('on', false), true)
  assert.equal(shuffleAtStart('off', true), false)
  assert.equal(repeatAtStart('remember', 'all'), 'all')
  assert.equal(repeatAtStart('one', 'off'), 'one')
  assert.equal(repeatAtStart('off', 'all'), 'off')
})

test('previous restarts a song only after the chosen time; 0 means never', () => {
  assert.equal(restartsSong(4, 3), true)
  assert.equal(restartsSong(3, 3), false)
  assert.equal(restartsSong(1, 3), false)
  assert.equal(restartsSong(20, 0), false)
  assert.equal(restartsSong(20, 10), true)
  assert.equal(restartsSong(8, 10), false)
})

test('add to queue puts a song at the very end and keeps every song once', () => {
  assert.deepEqual(placeLast(['a', 'b', 'c'], 'a'), ['b', 'c', 'a'])
  assert.deepEqual(placeLast(['a', 'b', 'c'], 'c'), ['a', 'b', 'c'])
  assert.deepEqual(placeLast(['a', 'b'], 'z'), ['a', 'b', 'z'])
  assert.deepEqual(placeLast([], 'z'), ['z'])
})
