import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { CHECK_FAILED, createUpdates, DOWNLOAD_FAILED, NOT_INSTALLED, type UpdaterLike } from '../src/main/updates.ts'
import type { UpdateState } from '../src/shared/types.ts'

/** Stands in for electron-updater: it emits the same events, in the same order, as the real one. */
class FakeUpdater extends EventEmitter {
  latest: string | null = null
  checkError: Error | null = null
  downloadError: Error | null = null
  disabled = false
  checks = 0
  downloads = 0
  installs = 0
  percents = [30, 60.4, 100]

  async checkForUpdates(): Promise<unknown> {
    this.checks++
    if (this.disabled) return null
    if (this.checkError !== null) {
      this.emit('error', this.checkError)
      throw this.checkError
    }
    if (this.latest === null) this.emit('update-not-available')
    else this.emit('update-available', { version: this.latest })
    return {}
  }

  async downloadUpdate(): Promise<unknown> {
    this.downloads++
    if (this.downloadError !== null) {
      this.emit('error', this.downloadError)
      throw this.downloadError
    }
    for (const percent of this.percents) this.emit('download-progress', { percent })
    this.emit('update-downloaded', { version: this.latest })
    return []
  }

  quitAndInstall(): void {
    this.installs++
  }
}

function setup() {
  const updater = new FakeUpdater()
  const seen: UpdateState[] = []
  const updates = createUpdates(updater as unknown as UpdaterLike, (state) => seen.push(state))
  return { updater, seen, updates }
}

test('a look at start that finds a newer version offers it and downloads nothing', async () => {
  const { updater, updates } = setup()
  updater.latest = '0.3.0'
  await updates.checkQuietly()
  assert.deepEqual(updates.state(), { kind: 'available', version: '0.3.0' })
  assert.equal(updater.downloads, 0)
  assert.equal(updater.installs, 0)
})

test('a look at start stays silent when there is nothing new or when it fails', async () => {
  const { updater, seen, updates } = setup()
  await updates.checkQuietly()
  updater.checkError = new Error('getaddrinfo ENOTFOUND github.com')
  await updates.checkQuietly()
  assert.equal(updates.state().kind, 'idle')
  assert.equal(seen.every((state) => state.kind === 'idle'), true)
})

test('a check the person asked for says "up to date" or gives a plain reason without technical text', async () => {
  const { updater, updates } = setup()
  await updates.check()
  assert.deepEqual(updates.state(), { kind: 'none' })

  updater.checkError = new Error('getaddrinfo ENOTFOUND github.com')
  await updates.check()
  assert.deepEqual(updates.state(), { kind: 'error', message: CHECK_FAILED })
  assert.equal(CHECK_FAILED.includes('ENOTFOUND'), false)
})

test('a program that is not installed says so only when asked', async () => {
  const { updater, updates } = setup()
  updater.disabled = true
  await updates.checkQuietly()
  assert.equal(updates.state().kind, 'idle')
  await updates.check()
  assert.deepEqual(updates.state(), { kind: 'error', message: NOT_INSTALLED })
})

test('a check shows "checking" first', async () => {
  const { updater, seen, updates } = setup()
  updater.latest = '0.3.0'
  await updates.check()
  assert.deepEqual(seen.map((state) => state.kind), ['checking', 'available'])
})

test('download reports progress, then ready, and install needs the ready state', async () => {
  const { updater, seen, updates } = setup()
  updater.latest = '0.3.0'
  updates.install()
  assert.equal(updater.installs, 0)
  await updates.download()
  assert.equal(updater.downloads, 0, 'nothing is offered yet, so nothing downloads')

  await updates.checkQuietly()
  updates.install()
  assert.equal(updater.installs, 0, 'an offer alone cannot install')
  await updates.download()
  assert.deepEqual(
    seen.map((state) => (state.kind === 'downloading' ? `downloading ${state.percent}` : state.kind)),
    ['available', 'downloading 0', 'downloading 30', 'downloading 60', 'downloading 100', 'ready'],
  )
  assert.deepEqual(updates.state(), { kind: 'ready', version: '0.3.0' })
  updates.install()
  assert.equal(updater.installs, 1)
})

test('a failed download keeps the version on offer with a plain problem, and it can be tried again', async () => {
  const { updater, updates } = setup()
  updater.latest = '0.3.0'
  await updates.checkQuietly()
  updater.downloadError = new Error('net::ERR_INTERNET_DISCONNECTED')
  await updates.download()
  assert.deepEqual(updates.state(), { kind: 'available', version: '0.3.0', problem: DOWNLOAD_FAILED })

  updater.downloadError = null
  await updates.download()
  assert.deepEqual(updates.state(), { kind: 'ready', version: '0.3.0' })
})

test('a new look is ignored while a download runs or waits for the restart', async () => {
  const { updater, updates } = setup()
  updater.latest = '0.3.0'
  await updates.checkQuietly()
  await updates.download()
  const checks = updater.checks
  await updates.check()
  await updates.checkQuietly()
  assert.equal(updater.checks, checks)
  assert.equal(updates.state().kind, 'ready')
})

test('progress outside 0 to 100 is kept in range and ignored when nothing downloads', async () => {
  const { updater, seen, updates } = setup()
  updater.latest = '0.3.0'
  updater.percents = [-5, 140]
  updater.emit('download-progress', { percent: 50 })
  assert.equal(seen.length, 0)
  await updates.checkQuietly()
  await updates.download()
  const percents = seen.flatMap((state) => (state.kind === 'downloading' ? [state.percent] : []))
  assert.deepEqual(percents, [0, 0, 100])
})
