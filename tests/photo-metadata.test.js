const test = require('node:test'), assert = require('node:assert/strict')
const { parseMetadata, toGcj02 } = require('../miniprogram/utils/photo-metadata')
function tiff(little = true, date = '2020:01:02 00:01:05') {
  const b = Buffer.alloc(216), v = new DataView(b.buffer, b.byteOffset, b.length)
  const u16 = (p, n) => v.setUint16(p, n, little), u32 = (p, n) => v.setUint32(p, n, little)
  b.write(little ? 'II' : 'MM'); u16(2, 42); u32(4, 8)
  function entry(p, tag, type, n, value) { u16(p, tag); u16(p+2, type); u32(p+4, n); u32(p+8, value) }
  u16(8, 2); entry(10, 0x8769, 4, 1, 40); entry(22, 0x8825, 4, 1, 64)
  u16(40, 1); entry(42, 0x9003, 2, 20, 128); b.write(date, 128)
  u16(64, 4); entry(66, 1, 2, 2, 0); b.write('N', 74)
  entry(78, 2, 5, 3, 160); entry(90, 3, 2, 2, 0); b.write('E', 98)
  entry(102, 4, 5, 3, 192)
  for (const [p, values] of [[160, [39, 54, 0]], [192, [116, 24, 0]]])
    values.forEach((n, i) => { u32(p+i*8, n); u32(p+i*8+4, 1) })
  return b
}
function jpeg(data) {
  const n = Buffer.alloc(2); n.writeUInt16BE(data.length + 8)
  return Buffer.concat([Buffer.from('ffd8ffe1', 'hex'), n, Buffer.from('Exif\0\0'), data, Buffer.from('ffd9', 'hex')])
}
for (const little of [true, false]) test(`JPEG reads camera date and GPS from ${little?'little':'big'} endian EXIF`, () => {
  const result = parseMetadata(jpeg(tiff(little)))
  assert.equal(result.takenOn, '2020-01-02')
  assert.ok(result.latitude > 39.9 && result.latitude < 39.91)
  assert.ok(result.longitude > 116.4 && result.longitude < 116.41)
})
test('PNG and WebP embedded EXIF use the same camera metadata parser', () => {
  const data = tiff(), size = Buffer.alloc(4); size.writeUInt32BE(data.length)
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), size, Buffer.from('eXIf'), data, Buffer.alloc(4)])
  assert.equal(parseMetadata(png).takenOn, '2020-01-02')
  const webpSize = Buffer.alloc(4); webpSize.writeUInt32LE(data.length)
  const riffSize = Buffer.alloc(4); riffSize.writeUInt32LE(data.length + 12)
  const webp = Buffer.concat([Buffer.from('RIFF'), riffSize, Buffer.from('WEBPEXIF'), webpSize, data])
  assert.equal(parseMetadata(webp).takenOn, '2020-01-02')
})
test('missing, truncated and invalid metadata never invents a date or current position', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('screenshot'), jpeg(tiff()).subarray(0, 45)])
    assert.deepEqual(parseMetadata(bytes), {})
  const invalid = parseMetadata(jpeg(tiff(true, '2020:02:31 12:00:00')))
  assert.equal(invalid.takenOn, undefined)
  const broken = tiff(); broken.writeUInt32LE(0xfffffff0, 50)
  assert.equal(parseMetadata(jpeg(broken)).takenOn, undefined)
  assert.deepEqual(toGcj02(40.75, -74), { latitude: 40.75, longitude: -74 })
})

test('distinguishes a JPEG without EXIF from one containing invalid date data', () => {
  const stripped = {}
  const jpegWithoutExif = Buffer.from('ffd8ffe000084a4649460000ffd9', 'hex')
  assert.deepEqual(parseMetadata(jpegWithoutExif, stripped), {})
  assert.equal(stripped.format, 'JPEG')
  assert.equal(stripped.exif, undefined)

  const malformed = {}
  const result = parseMetadata(jpeg(tiff(true, '2020:02:31 12:00:00')), malformed)
  assert.equal(malformed.exif, true)
  assert.equal(malformed.dateField, true)
  assert.equal(malformed.gpsFields, true)
  assert.equal(result.takenOn, undefined)
  assert.ok(Number.isFinite(result.latitude))
})

test('distinguishes missing date and GPS tags from unreadable directory entries', () => {
  const limited = tiff()
  limited.writeUInt16LE(0, 8) // Valid EXIF root, but no date or subdirectories.
  const absent = {}
  assert.deepEqual(parseMetadata(jpeg(limited), absent), {})
  assert.equal(absent.rootDirectory.status, 'read')
  assert.equal(absent.gpsDirectory.status, 'absent')
  assert.equal(absent.dateTag, false)

  const invalid = tiff()
  invalid.writeUInt32LE(0xfffffff0, 30) // GPS offset points outside the file.
  invalid.writeUInt32LE(0xfffffff0, 50) // Date tag exists with an invalid value offset.
  const diagnostic = {}
  assert.deepEqual(parseMetadata(jpeg(invalid), diagnostic), {})
  assert.equal(diagnostic.gpsDirectory.status, 'invalid')
  assert.equal(diagnostic.dateTag, true)
  assert.equal(diagnostic.dateField, false)
})
