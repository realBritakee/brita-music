import assert from 'node:assert/strict'
import test from 'node:test'
import { HOME_URL, isAllowedAddress, resolveTypedAddress, sanitizeBounds } from '../src/main/browserModel.ts'

test('any web page is allowed, on http or https', () => {
  assert.equal(isAllowedAddress(HOME_URL), true)
  assert.equal(isAllowedAddress('https://www.youtube.com/watch?v=abc123'), true)
  assert.equal(isAllowedAddress('https://example.com/some/page'), true)
  assert.equal(isAllowedAddress('http://example.com:8080/'), true)
  assert.equal(isAllowedAddress('http://127.0.0.1:5555/'), true)
})

test('files, scripts, the app addresses and bad text are refused', () => {
  assert.equal(isAllowedAddress('file:///C:/Windows/win.ini'), false)
  assert.equal(isAllowedAddress('javascript:alert(1)'), false)
  assert.equal(isAllowedAddress('data:text/html,hi'), false)
  assert.equal(isAllowedAddress('brita-media://song/x'), false)
  assert.equal(isAllowedAddress('chrome://settings'), false)
  assert.equal(isAllowedAddress('ftp://example.com/'), false)
  assert.equal(isAllowedAddress('not an address'), false)
  assert.equal(isAllowedAddress(''), false)
  assert.equal(isAllowedAddress(undefined), false)
})

test('typed web addresses open as they are, and https is added when missing', () => {
  assert.equal(resolveTypedAddress('https://example.com/a'), 'https://example.com/a')
  assert.equal(resolveTypedAddress('http://example.com'), 'http://example.com/')
  assert.equal(resolveTypedAddress('example.com'), 'https://example.com/')
  assert.equal(resolveTypedAddress('  www.youtube.com/watch?v=abc  '), 'https://www.youtube.com/watch?v=abc')
  assert.equal(resolveTypedAddress('localhost:3000/x'), 'https://localhost:3000/x')
  assert.equal(resolveTypedAddress('192.168.1.5:8080'), 'https://192.168.1.5:8080/')
})

test('other typed words are searched on YouTube', () => {
  assert.equal(resolveTypedAddress('the white buffalo'), `${HOME_URL}results?search_query=the%20white%20buffalo`)
  assert.equal(resolveTypedAddress('song'), `${HOME_URL}results?search_query=song`)
  assert.equal(resolveTypedAddress('ac/dc back in black'), `${HOME_URL}results?search_query=ac%2Fdc%20back%20in%20black`)
})

test('typed text that is not a web page is refused', () => {
  assert.equal(resolveTypedAddress('file:///C:/Windows/win.ini'), null)
  assert.equal(resolveTypedAddress('javascript:alert(1)'), null)
  assert.equal(resolveTypedAddress('brita-media://song/x'), null)
  assert.equal(resolveTypedAddress('   '), null)
  assert.equal(resolveTypedAddress(''), null)
  assert.equal(resolveTypedAddress(42), null)
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
