import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createPlaylist, nameProblem } from '../src/main/playlist.ts'
import { createWatcher, type FolderWatcher } from '../src/main/watch.ts'

let base: string

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'brita-live-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, timeout = 6000): Promise<boolean> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (condition()) return true
    await sleep(40)
  }
  return condition()
}

async function folder(name: string): Promise<string> {
  const full = path.join(base, name)
  await mkdir(full, { recursive: true })
  return full
}

// ---------- New playlist ----------

test('names Windows would refuse are explained in plain words', () => {
  for (const bad of ['', 'a/b', 'a\\b', 'what?', 'a:b', 'say "hi"', 'x|y', 'a<b', 'tab\there', 'dot.', 'space ', 'CON', 'nul', 'Com1', 'aux.txt', '$Recycle.Bin']) {
    assert.notEqual(nameProblem(bad), null, `"${bad}" should be refused`)
  }
  assert.notEqual(nameProblem('x'.repeat(101)), null)
  for (const good of ['Road trip', 'The White Buffalo', 'Ärzte & Co', '2024', 'console', 'dot.in.middle']) {
    assert.equal(nameProblem(good), null, `"${good}" should be fine`)
  }
})

test('a new playlist is a real, empty folder with the given name', async () => {
  const music = await folder('new-1')
  const result = await createPlaylist([music], music, '  Road trip  ')
  assert.deepEqual(result, { ok: true, name: 'Road trip' })
  assert.deepEqual(await readdir(music), ['Road trip'])
  assert.deepEqual(await readdir(path.join(music, 'Road trip')), [])
})

test('a name that already exists is refused, whatever its case, and nothing is overwritten', async () => {
  const music = await folder('new-2')
  await mkdir(path.join(music, 'Rock'))
  await writeFile(path.join(music, 'Rock', 'keep.mp3'), 'x')
  const result = await createPlaylist([music], music, 'ROCK')
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.message, /already exists/)
  assert.deepEqual(await readdir(path.join(music, 'Rock')), ['keep.mp3'])
  assert.deepEqual(await readdir(music), ['Rock'])
})

test('a name taken in another music folder counts as taken', async () => {
  const first = await folder('new-3a')
  const second = await folder('new-3b')
  await mkdir(path.join(second, 'Jazz'))
  const result = await createPlaylist([first, second], first, 'jazz')
  assert.equal(result.ok, false)
  assert.deepEqual(await readdir(first), [])
})

test('a name with a path in it cannot leave the music folder', async () => {
  const music = await folder('new-4')
  for (const bad of ['..\\escaped', '../escaped', 'a\\b', 'C:\\escaped']) {
    const result = await createPlaylist([music], music, bad)
    assert.equal(result.ok, false, bad)
  }
  assert.deepEqual(await readdir(music), [])
  assert.deepEqual((await readdir(base)).filter((name) => name.includes('escaped')), [])
})

test('only a music folder the app knows can be used', async () => {
  const music = await folder('new-5')
  const other = await folder('new-5-other')
  const result = await createPlaylist([music], other, 'Sneaky')
  assert.equal(result.ok, false)
  assert.deepEqual(await readdir(other), [])
  assert.equal((await createPlaylist([music], 42, 'x')).ok, false)
  assert.equal((await createPlaylist([music], music, 42)).ok, false)
})

test('a music folder that is gone gives a clear message', async () => {
  const gone = path.join(base, 'new-6-gone')
  const result = await createPlaylist([gone], gone, 'Anything')
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.message, /cannot be found/)
})

test('the folder is chosen by name without case, as Windows does', async () => {
  const music = await folder('new-7')
  const result = await createPlaylist([music], music.toUpperCase(), 'Case')
  assert.equal(result.ok, true)
  assert.deepEqual(await readdir(music), ['Case'])
})

// ---------- Watching ----------

const quick = { quietMs: 120, maxWaitMs: 1000, checkEveryMs: 150 }

function counting(): { watcher: FolderWatcher; calls: () => number } {
  let calls = 0
  const watcher = createWatcher(() => { calls++ }, quick)
  return { watcher, calls: () => calls }
}

test('a new folder with a song inside is noticed', async () => {
  const music = await folder('watch-1')
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    await mkdir(path.join(music, 'New Band'))
    await writeFile(path.join(music, 'New Band', 'song.mp3'), 'x')
    assert.equal(await waitFor(() => calls() > 0), true)
  } finally {
    watcher.close()
  }
})

test('a change deep inside a playlist is noticed', async () => {
  const music = await folder('watch-2')
  await mkdir(path.join(music, 'A', 'Album', 'Disc 2'), { recursive: true })
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    await writeFile(path.join(music, 'A', 'Album', 'Disc 2', 'deep.flac'), 'x')
    assert.equal(await waitFor(() => calls() > 0), true)
  } finally {
    watcher.close()
  }
})

test('a burst of changes, like a big copy, is reported once', async () => {
  const music = await folder('watch-3')
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    for (let i = 0; i < 40; i++) await writeFile(path.join(music, `song ${i}.mp3`), 'x')
    assert.equal(await waitFor(() => calls() > 0), true)
    await sleep(600)
    assert.equal(calls(), 1)
  } finally {
    watcher.close()
  }
})

test('a missing folder is picked up when it comes back, and watched from then on', async () => {
  const music = path.join(base, 'watch-4-later')
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    await sleep(500)
    assert.equal(calls(), 0)
    await mkdir(music)
    assert.equal(await waitFor(() => calls() > 0), true, 'the folder coming back is reported')
    await sleep(500)
    const before = calls()
    await writeFile(path.join(music, 'after.mp3'), 'x')
    assert.equal(await waitFor(() => calls() > before), true, 'a change after it came back is reported')
  } finally {
    watcher.close()
  }
})

test('a watched folder that disappears is reported', async () => {
  const music = await folder('watch-5')
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    await sleep(300)
    await rm(music, { recursive: true, force: true })
    assert.equal(await waitFor(() => calls() > 0), true)
  } finally {
    watcher.close()
  }
})

test('a folder taken out of the list is no longer watched', async () => {
  const music = await folder('watch-6')
  const { watcher, calls } = counting()
  try {
    watcher.sync([music])
    watcher.sync([])
    await writeFile(path.join(music, 'ignored.mp3'), 'x')
    await sleep(700)
    assert.equal(calls(), 0)
  } finally {
    watcher.close()
  }
})

test('a closed watcher stays quiet', async () => {
  const music = await folder('watch-7')
  const { watcher, calls } = counting()
  watcher.sync([music])
  watcher.close()
  await writeFile(path.join(music, 'late.mp3'), 'x')
  await sleep(500)
  assert.equal(calls(), 0)
})
