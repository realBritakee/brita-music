import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_URL, isAllowedAddress, sanitizeBounds } from '../src/main/browserModel.ts'

test('the start page and normal YouTube pages are allowed', () => {
  assert.equal(isAllowedAddress(HOME_URL), true)
  assert.equal(isAllowedAddress('https://www.youtube.com/watch?v=abc123'), true)
  assert.equal(isAllowedAddress('https://music.youtube.com/'), true)
  assert.equal(isAllowedAddress('https://youtube.com/results?search_query=song'), true)
  assert.equal(isAllowedAddress('https://youtu.be/abc123'), true)
})

test("Google's sign-in and consent pages are allowed", () => {
  assert.equal(isAllowedAddress('https://accounts.google.com/ServiceLogin'), true)
  assert.equal(isAllowedAddress('https://consent.google.com/m?continue=https://www.youtube.com'), true)
})

test('other sites, look-alike names and other google pages are blocked', () => {
  assert.equal(isAllowedAddress('https://example.com/'), false)
  assert.equal(isAllowedAddress('https://www.google.com/'), false)
  assert.equal(isAllowedAddress('https://evilyoutube.com/'), false)
  assert.equal(isAllowedAddress('https://youtube.com.evil.example/'), false)
  assert.equal(isAllowedAddress('https://notyoutu.be/'), false)
})

test('plain http, odd ports, logins in the address and other schemes are blocked', () => {
  assert.equal(isAllowedAddress('http://www.youtube.com/'), false)
  assert.equal(isAllowedAddress('https://www.youtube.com:8443/'), false)
  assert.equal(isAllowedAddress('https://user:pass@www.youtube.com/'), false)
  assert.equal(isAllowedAddress('file:///C:/Windows/win.ini'), false)
  assert.equal(isAllowedAddress('javascript:alert(1)'), false)
  assert.equal(isAllowedAddress('brita-media://song/x'), false)
  assert.equal(isAllowedAddress('not an address'), false)
  assert.equal(isAllowedAddress(''), false)
  assert.equal(isAllowedAddress(undefined), false)
})

test('test hosts are allowed only when given, and only for the app check', () => {
  assert.equal(isAllowedAddress('http://127.0.0.1:5555/'), false)
  assert.equal(isAllowedAddress('http://127.0.0.1:5555/', ['127.0.0.1']), true)
  assert.equal(isAllowedAddress('http://localhost:5555/', ['127.0.0.1']), false)
  assert.equal(isAllowedAddress('ftp://127.0.0.1/', ['127.0.0.1']), false)
})

test('bounds are rounded and bad ones are refused', () => {
  assert.deepEqual(sanitizeBounds({ x: 240.4, y: 12.6, width: 900.2, height: 500.5 }), { x: 240, y: 13, width: 900, height: 501 })
  assert.equal(sanitizeBounds({ x: -1, y: 0, width: 10, height: 10 }), null)
  assert.equal(sanitizeBounds({ x: 0, y: 0, width: 0, height: 10 }), null)
  assert.equal(sanitizeBounds({ x: 0, y: 0, width: 10, height: 99999 }), null)
  assert.equal(sanitizeBounds({ x: 'a', y: 0, width: 10, height: 10 }), null)
  assert.equal(sanitizeBounds({ x: NaN, y: 0, width: 10, height: 10 }), null)
  assert.equal(sanitizeBounds(null), null)
  assert.equal(sanitizeBounds('big'), null)
})
