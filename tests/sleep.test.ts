import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fadeFactor, formatLeft, secondsLeft, sleepAfter, sleepLabel, sleepTitle, SLEEP_MINUTES, SLEEP_OFF } from '../src/renderer/src/sleep.ts'

test('a timed sleep ends the chosen minutes from now', () => {
  assert.deepEqual(sleepAfter(15, 1_000), { kind: 'time', endsAt: 1_000 + 15 * 60_000 })
  assert.deepEqual([...SLEEP_MINUTES], [15, 30, 60])
})

test('seconds left round up and never go below zero', () => {
  assert.equal(secondsLeft(10_000, 0), 10)
  assert.equal(secondsLeft(10_001, 0), 11)
  assert.equal(secondsLeft(10_000, 9_999), 1)
  assert.equal(secondsLeft(10_000, 10_000), 0)
  assert.equal(secondsLeft(10_000, 50_000), 0)
})

test('the time left reads as minutes and seconds, with hours from 60 minutes', () => {
  assert.equal(formatLeft(0), '0:00')
  assert.equal(formatLeft(59), '0:59')
  assert.equal(formatLeft(15 * 60), '15:00')
  assert.equal(formatLeft(872), '14:32')
  assert.equal(formatLeft(3599), '59:59')
  assert.equal(formatLeft(3600), '1:00:00')
  assert.equal(formatLeft(3661), '1:01:01')
  assert.equal(formatLeft(-5), '0:00')
})

test('the fade goes from full volume to silence and stays inside 0 to 1', () => {
  assert.equal(fadeFactor(0), 1)
  assert.equal(fadeFactor(1500, 3), 0.5)
  assert.equal(fadeFactor(3000, 3), 0)
  assert.equal(fadeFactor(99_000, 3), 0)
  assert.equal(fadeFactor(-500, 3), 1)
})

test('the button label and tooltip follow the timer', () => {
  assert.equal(sleepLabel(SLEEP_OFF, 0), '')
  assert.equal(sleepLabel({ kind: 'song' }, 0), 'Song end')
  assert.equal(sleepLabel({ kind: 'time', endsAt: 1 }, 872), '14:32')
  assert.equal(sleepTitle(SLEEP_OFF, 0), 'Sleep timer')
  assert.equal(sleepTitle({ kind: 'song' }, 0), 'Sleep timer: stops after this song')
  assert.equal(sleepTitle({ kind: 'time', endsAt: 1 }, 872), 'Sleep timer: stops in 14:32')
})
