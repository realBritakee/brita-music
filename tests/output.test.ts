import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeSettings } from '../src/main/persist.ts'
import { listOutputs, pickOutput, type RawDevice } from '../src/renderer/src/output.ts'

const out = (deviceId: string, label: string): RawDevice => ({ kind: 'audiooutput', deviceId, label })

// Shaped like the list this PC gave in the trial on 2026-11-05.
const PC: RawDevice[] = [
  out('default', 'Default - Lautsprecher (Realtek(R) Audio)'),
  out('communications', 'Communications - Kopfhörer (JBL Quantum 400 Chat)'),
  out('aaa', 'Lautsprecher (JBL Quantum 400 Game)'),
  out('bbb', 'Lautsprecher (Realtek(R) Audio)'),
  { kind: 'audioinput', deviceId: 'mic', label: 'Mikrofon' },
  { kind: 'videoinput', deviceId: 'cam', label: 'Kamera' },
]

test('outputs: the system default comes first, shows the device behind it, and inputs are left out', () => {
  const list = listOutputs(PC)
  assert.deepEqual(list.map((device) => device.id), ['', 'aaa', 'bbb'])
  assert.equal(list[0].label, 'System default: Lautsprecher (Realtek(R) Audio)')
  assert.equal(list[1].label, 'Lautsprecher (JBL Quantum 400 Game)')
})

test('outputs: with no devices at all, the list still offers the system default', () => {
  assert.deepEqual(listOutputs([]), [{ id: '', label: 'System default' }])
  assert.deepEqual(listOutputs([{ kind: 'audioinput', deviceId: 'mic', label: 'Mikrofon' }]), [{ id: '', label: 'System default' }])
})

test('outputs: a device without a name is called "Output 1", "Output 2"', () => {
  const list = listOutputs([out('default', ''), out('a', ''), out('b', 'Headset'), out('c', '')])
  assert.deepEqual(list.map((device) => device.label), ['System default', 'Output 1', 'Headset', 'Output 2'])
})

test('pick output: a connected device stays, a gone one falls back to the system default', () => {
  const list = listOutputs(PC)
  assert.deepEqual(pickOutput('aaa', list), { id: 'aaa', lost: false })
  assert.deepEqual(pickOutput('', list), { id: '', lost: false })
  assert.deepEqual(pickOutput('unplugged', list), { id: '', lost: true })
  assert.deepEqual(pickOutput('aaa', listOutputs([])), { id: '', lost: true })
})

test('settings: the chosen output is kept, and a file from before it gets the system default', () => {
  assert.equal(sanitizeSettings({ outputDevice: 'aaa' }).outputDevice, 'aaa')
  assert.equal(sanitizeSettings({ volume: 0.4 }).outputDevice, '')
  assert.equal(sanitizeSettings({ outputDevice: 5 }).outputDevice, '')
  assert.equal(sanitizeSettings(null).outputDevice, '')
})
