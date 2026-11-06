// Makes small test songs without any audio tool: a WAV and a FLAC with a tone, an MP3 with silence.

const RATE = 8000
const SECONDS = 30

function toneSamples() {
  const samples = new Int16Array(RATE * SECONDS)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000)
  }
  return samples
}

function makeWav() {
  const samples = toneSamples()
  const header = Buffer.alloc(44)
  const dataSize = samples.length * 2
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, Buffer.from(samples.buffer)])
}

const zlib = require('node:zlib')

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A real 1x1 orange PNG, small enough to embed in a song. */
function makePng() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: RGB
  const pixel = zlib.deflateSync(Buffer.from([0, 255, 111, 0]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', pixel),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function id3Frame(id, body) {
  const header = Buffer.alloc(10)
  header.write(id, 0, 'latin1')
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

function id3Text(id, text) {
  // Encoding 1 is UTF-16 with a byte-order mark, which keeps umlauts intact.
  return id3Frame(id, Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
}

/** An ID3v2.3 tag in front of the audio. tags: { title, artist, album, picture } */
function makeId3(tags) {
  const frames = []
  if (tags.title) frames.push(id3Text('TIT2', tags.title))
  if (tags.artist) frames.push(id3Text('TPE1', tags.artist))
  if (tags.album) frames.push(id3Text('TALB', tags.album))
  if (tags.picture) {
    const start = Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0])])
    frames.push(id3Frame('APIC', Buffer.concat([start, tags.picture])))
  }
  const body = Buffer.concat(frames)
  const header = Buffer.alloc(10)
  header.write('ID3', 0, 'latin1')
  header[3] = 3
  for (let i = 0; i < 4; i++) header[6 + i] = (body.length >> (7 * (3 - i))) & 0x7f
  return Buffer.concat([header, body])
}

function makeMp3(tags) {
  // MPEG 1 Layer 3, 128 kbit/s, 44100 Hz: 417 bytes per frame, 1152 samples per frame.
  const frame = Buffer.alloc(417)
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame)
  const frames = Math.round((SECONDS * 44100) / 1152)
  const audio = Buffer.concat(Array.from({ length: frames }, () => frame))
  return tags ? Buffer.concat([makeId3(tags), audio]) : audio
}

function le32(value) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}

/** Vorbis comments as used by FLAC and Opus. tags: { title, artist, album } */
function vorbisComments(tags) {
  const vendor = Buffer.from('brita-test')
  const entries = Object.entries(tags).map(([key, value]) => Buffer.from(`${key.toUpperCase()}=${value}`, 'utf8'))
  return Buffer.concat([le32(vendor.length), vendor, le32(entries.length), ...entries.flatMap((entry) => [le32(entry.length), entry])])
}

function crc8(bytes) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
  }
  return crc
}

function crc16(bytes) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

function flacFrame(samples, frameNumber) {
  if (frameNumber > 0x7ff) throw new Error('Test FLAC is too long')
  const number = frameNumber < 0x80
    ? [frameNumber]
    : [0xc0 | (frameNumber >> 6), 0x80 | (frameNumber & 0x3f)]
  // Block size 4096, sample rate from the file header, mono, 16 bit.
  const head = Buffer.from([0xff, 0xf8, 0xc0, 0x08, ...number])
  const body = Buffer.alloc(1 + samples.length * 2)
  body[0] = 0x02 // Subframe holding plain, uncompressed samples.
  samples.forEach((sample, i) => body.writeInt16BE(sample, 1 + i * 2))
  const frame = Buffer.concat([head, Buffer.from([crc8(head)]), body])
  const end = Buffer.alloc(2)
  end.writeUInt16BE(crc16(frame))
  return Buffer.concat([frame, end])
}

function makeFlac(tags) {
  const BLOCK = 4096
  const all = toneSamples()
  const blocks = Math.floor(all.length / BLOCK)
  const info = Buffer.alloc(34)
  info.writeUInt16BE(BLOCK, 0)
  info.writeUInt16BE(BLOCK, 2)
  // 20 bits sample rate, 3 bits channels minus 1, 5 bits sample size minus 1, 36 bits total samples.
  const packed = (BigInt(RATE) << 44n) | (0n << 41n) | (15n << 36n) | BigInt(blocks * BLOCK)
  info.writeBigUInt64BE(packed, 10)
  const frames = []
  for (let i = 0; i < blocks; i++) frames.push(flacFrame(all.subarray(i * BLOCK, (i + 1) * BLOCK), i))
  const streamInfo = Buffer.concat([Buffer.from([tags ? 0x00 : 0x80, 0, 0, 34]), info])
  let comment = Buffer.alloc(0)
  if (tags) {
    const body = vorbisComments(tags)
    comment = Buffer.concat([Buffer.from([0x84, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]), body])
  }
  return Buffer.concat([Buffer.from('fLaC'), streamInfo, comment, ...frames])
}

function oggCrc(bytes) {
  let crc = 0
  for (const byte of bytes) {
    crc = (crc ^ (byte << 24)) >>> 0
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0
  }
  return crc
}

function oggPage(packets, flags, granule, sequence) {
  const header = Buffer.alloc(27)
  header.write('OggS', 0)
  header[5] = flags
  header.writeBigUInt64LE(BigInt(granule), 6)
  header.writeUInt32LE(1, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = packets.length
  const page = Buffer.concat([header, Buffer.from(packets.map((packet) => packet.length)), ...packets])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function makeOpus(songTags) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0)
  head[8] = 1
  head[9] = 2
  head.writeUInt32LE(48000, 12)
  const tags = Buffer.concat([Buffer.from('OpusTags'), songTags ? vorbisComments(songTags) : Buffer.alloc(8)])
  const silence = Buffer.from([0xf8, 0xff, 0xfe]) // One 20 ms Opus packet of silence.
  const pages = [oggPage([head], 2, 0, 0), oggPage([tags], 0, 0, 1)]
  const pageCount = (SECONDS * 50) / 50
  for (let i = 0; i < pageCount; i++) {
    const last = i === pageCount - 1
    pages.push(oggPage(Array(50).fill(silence), last ? 4 : 0, (i + 1) * 50 * 960, i + 2))
  }
  return Buffer.concat(pages)
}

module.exports = { makeWav, makeMp3, makeFlac, makeOpus, makePng }
