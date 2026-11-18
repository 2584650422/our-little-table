// Read only embedded camera date and GPS. Missing metadata is never replaced by
// the file modification date, today's date, or the user's current GPS position.
function parseMetadata(buffer, diagnostic = {}) {
  try {
    const view = ArrayBuffer.isView(buffer)
      ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new DataView(buffer)
    const size = view.byteLength
    const text = (offset, length) => {
      if (offset < 0 || offset + length > size) return ''
      let value = ''
      for (let i = 0; i < length; i++) value += String.fromCharCode(view.getUint8(offset + i))
      return value
    }
    function tiff(base, end) {
      diagnostic.exif = true
      if (end - base < 8) return {}
      const little = text(base, 2) === 'II'
      if (!little && text(base, 2) !== 'MM') return {}
      const u16 = (p) => {
        if (p < base || p + 2 > end) throw Error()
        return view.getUint16(p, little)
      }
      const u32 = (p) => {
        if (p < base || p + 4 > end) throw Error()
        return view.getUint32(p, little)
      }
      if (u16(base + 2) !== 42) return {}
      const ifd = (offset, name) => {
        const result = {}
        const directory = { status: 'invalid', tags: [] }
        diagnostic[name] = directory
        const at = base + offset
        if (!Number.isInteger(offset) || at < base || at + 2 > end) return result
        const count = u16(at)
        if (count > 512 || at + 2 + count * 12 > end) return result
        directory.status = 'read'
        for (let i = 0; i < count; i++) {
          const p = at + 2 + i * 12,
            tag = u16(p),
            type = u16(p + 2),
            n = u32(p + 4)
          directory.tags.push(tag)
          const bytes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type]
          if (!bytes || n > 512 || !n) continue
          const start = bytes * n <= 4 ? p + 8 : base + u32(p + 8)
          if (start < base || start + n * bytes > end) continue
          if (type === 2) result[tag] = text(start, n).replace(/\0.*$/, '').trim()
          else {
            const values = []
            for (let j = 0; j < n; j++) {
              const pos = start + j * bytes
              values.push(
                type === 1
                  ? view.getUint8(pos)
                  : type === 3
                    ? u16(pos)
                    : type === 4
                      ? u32(pos)
                      : u32(pos + 4)
                        ? u32(pos) / u32(pos + 4)
                        : NaN,
              )
            }
            result[tag] = n === 1 ? values[0] : values
          }
        }
        return result
      }
      const root = ifd(u32(base + 4), 'rootDirectory')
      const readDirectory = (pointer, name) => {
        if (root[pointer]) return ifd(root[pointer], name)
        diagnostic[name] = {
          status:
            diagnostic.rootDirectory.status !== 'read' ||
            diagnostic.rootDirectory.tags.includes(pointer)
              ? 'invalid'
              : 'absent',
          tags: [],
        }
        return {}
      }
      const exif = readDirectory(0x8769, 'exifDirectory')
      const gps = readDirectory(0x8825, 'gpsDirectory')
      const result = {}
      const dateValue = exif[0x9003] || exif[0x9004] || root[0x132]
      diagnostic.dateTag =
        diagnostic.rootDirectory.tags.includes(0x132) ||
        diagnostic.exifDirectory.tags.some((tag) => tag === 0x9003 || tag === 0x9004)
      diagnostic.gpsCoordinateTags = diagnostic.gpsDirectory.tags.filter(
        (tag) => tag === 2 || tag === 4,
      ).length
      diagnostic.dateField = Boolean(dateValue)
      diagnostic.gpsFields = Boolean(gps[2] && gps[4])
      const date = String(dateValue || '').match(/^(\d{4}):(\d{2}):(\d{2}) /)
      if (date) {
        const [, y, m, d] = date
        const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
        if (
          check.getUTCFullYear() === Number(y) &&
          check.getUTCMonth() + 1 === Number(m) &&
          check.getUTCDate() === Number(d)
        )
          result.takenOn = `${y}-${m}-${d}`
      }
      const coordinate = (values) =>
        Array.isArray(values) && values.length === 3
          ? values[0] + values[1] / 60 + values[2] / 3600
          : NaN
      const lat = coordinate(gps[2]) * (gps[1] === 'S' ? -1 : 1)
      const lng = coordinate(gps[4]) * (gps[3] === 'W' ? -1 : 1)
      if (
        ['N', 'S'].includes(gps[1]) &&
        ['E', 'W'].includes(gps[3]) &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180
      ) {
        const position = toGcj02(lat, lng)
        result.latitude = position.latitude
        result.longitude = position.longitude
      }
      return result
    }
    if (size < 12) return {}
    if (view.getUint16(0) === 0xffd8) {
      diagnostic.format = 'JPEG'
      for (let p = 2; p + 4 <= size; ) {
        if (view.getUint8(p) !== 0xff) break
        const marker = view.getUint8(p + 1)
        if (marker === 0xff) {
          p++
          continue
        }
        if (marker === 0xda || marker === 0xd9) break
        const length = view.getUint16(p + 2)
        if (length < 2 || p + 2 + length > size) break
        if (marker === 0xe1 && text(p + 4, 6) === 'Exif\0\0') return tiff(p + 10, p + 2 + length)
        p += 2 + length
      }
    } else if (text(1, 3) === 'PNG') {
      diagnostic.format = 'PNG'
      for (let p = 8; p + 12 <= size; ) {
        const n = view.getUint32(p)
        if (p + n + 12 > size) break
        if (text(p + 4, 4) === 'eXIf') return tiff(p + 8, p + 8 + n)
        p += n + 12
      }
    } else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
      diagnostic.format = 'WebP'
      for (let p = 12; p + 8 <= size; ) {
        const n = view.getUint32(p + 4, true)
        if (p + n + 8 > size) break
        if (text(p, 4) === 'EXIF')
          return tiff(p + 8 + (text(p + 8, 6) === 'Exif\0\0' ? 6 : 0), p + 8 + n)
        p += 8 + n + (n % 2)
      }
    }
  } catch (_) {
    /* Damaged or unsupported metadata falls back to manual entry. */
  }
  return {}
}

// Camera GPS uses WGS84; WeChat map selection uses GCJ02. Apply the standard
// ellipsoid offset only within mainland China's coordinate-conversion bounds.
function toGcj02(latitude, longitude) {
  if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271)
    return { latitude, longitude }
  const province = require('./atlas-map').provinceForPhoto({ latitude, longitude })
  if (!province || ['台湾省', '香港特别行政区', '澳门特别行政区'].includes(province))
    return { latitude, longitude }
  const x = longitude - 105,
    y = latitude - 35,
    pi = Math.PI
  let lat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  lat += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3
  lat += ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3
  lat += ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3
  let lng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  lng += ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3
  lng += ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3
  lng += ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3
  const rad = (latitude / 180) * pi,
    sin = Math.sin(rad),
    magic = 1 - 0.006693421622965943 * sin * sin
  return {
    latitude:
      latitude +
      (lat * 180) / (((6378245 * (1 - 0.006693421622965943)) / (magic * Math.sqrt(magic))) * pi),
    longitude: longitude + (lng * 180) / ((6378245 / Math.sqrt(magic)) * Math.cos(rad) * pi),
  }
}
function readMetadata(path) {
  return new Promise((resolve) => {
    try {
      wx.getFileSystemManager().readFile({
        filePath: path,
        success: ({ data }) => {
          if (!data?.byteLength) return resolve({ readFailed: true })
          const diagnostic = {}
          const metadata = parseMetadata(data, diagnostic)
          resolve({ ...metadata, bytes: data.byteLength, diagnostic })
        },
        fail: () => resolve({ readFailed: true }),
      })
    } catch (_) {
      resolve({ readFailed: true })
    }
  })
}
module.exports = { parseMetadata, readMetadata, toGcj02 }
