// Province shapes are simplified DataV GeoAtlas boundaries projected to this same 600×465 map.
const provinces = require('../assets/atlas-provinces')
const SCALE = 416.3695106850359
const TRANSLATE_X = -457.9428915814261
const TRANSLATE_Y = 474.7017167958825
const DEG = Math.PI / 180
const CARD_WIDTH = 104
const CARD_HEIGHT = 80
const offsets = [
  [0, -88],
  [92, 0],
  [-92, 0],
  [0, 88],
  [82, -76],
  [-82, -76],
  [82, 76],
  [-82, 76],
  [0, -166],
  [166, 0],
  [-166, 0],
  [0, 166],
  [150, -130],
  [-150, -130],
  [150, 130],
  [-150, 130],
]

function position(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined)
    return null
  const lat = Number(latitude),
    lng = Number(longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) >= 85) return null
  const x = SCALE * lng * DEG + TRANSLATE_X
  const y = TRANSLATE_Y - SCALE * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2))
  if (x < 0 || x > 600 || y < 0 || y > 465) return null
  return { x, y }
}

function inRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    const crosses =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function provinceAt(x, y) {
  const point = { x: Number(x), y: Number(y) }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  for (const province of provinces) {
    for (const polygon of province.polygons) {
      if (inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole)))
        return province.name
    }
  }
  return null
}

function provinceForPhoto(photo) {
  const point = position(photo.latitude, photo.longitude)
  return point ? provinceAt(point.x, point.y) : null
}

function layoutPins(photos) {
  const occupied = []
  return photos
    .map((photo) => {
      const anchor = position(photo.latitude, photo.longitude)
      if (!anchor) return null
      const candidates = offsets
      let center = null
      for (let ring = 0; !center && ring < 4; ring++) {
        const radius = ring === 0 ? 1 : 1 + ring * 0.28
        for (const [dx, dy] of candidates) {
          const x = Math.max(CARD_WIDTH / 2, Math.min(600 - CARD_WIDTH / 2, anchor.x + dx * radius))
          const y = Math.max(
            CARD_HEIGHT / 2,
            Math.min(465 - CARD_HEIGHT / 2, anchor.y + dy * radius),
          )
          const free = occupied.every(
            (item) =>
              Math.abs(item.x - x) >= CARD_WIDTH + 9 || Math.abs(item.y - y) >= CARD_HEIGHT + 9,
          )
          if (free) {
            center = { x, y }
            break
          }
        }
      }
      center ||= { x: anchor.x, y: anchor.y }
      occupied.push(center)
      const dx = center.x - anchor.x,
        dy = center.y - anchor.y,
        length = Math.hypot(dx, dy)
      return {
        ...photo,
        province: provinceAt(anchor.x, anchor.y),
        left: `${((center.x / 600) * 100).toFixed(3)}%`,
        top: `${((center.y / 465) * 100).toFixed(3)}%`,
        anchorLeft: `${((anchor.x / 600) * 100).toFixed(3)}%`,
        anchorTop: `${((anchor.y / 465) * 100).toFixed(3)}%`,
        lineLength: `${(length * (670 / 600)).toFixed(1)}rpx`,
        lineAngle: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`,
      }
    })
    .filter(Boolean)
}

module.exports = { position, provinceAt, provinceForPhoto, layoutPins, provinces }
