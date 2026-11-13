// Board slots depend only on geography and viewport size, never on pan/zoom.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
function placeCards(items, width, height, options = {}) {
  const compact = options.compact
  const cardWidth = compact ? 34 : 56
  const cardHeight = compact ? 38 : 62
  const left = cardWidth / 2 + (compact ? 10 : 16)
  const right = width - left
  const top = compact ? 24 : 34
  const bottom = height - (compact ? 28 : 44)
  const sides = { top: [], bottom: [], left: [], right: [] }
  items.forEach((item) => sides[item.side || 'top'].push(item))
  const result = []
  Object.entries(sides).forEach(([side, group]) => {
    const horizontal = side === 'top' || side === 'bottom'
    group.sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        String(a.group?.id || '').localeCompare(String(b.group?.id || '')),
    )
    const min = horizontal ? Math.max(left + cardWidth + 10, width * 0.28) : top + cardHeight
    const max = horizontal
      ? Math.min(right - cardWidth - 10, width * 0.72)
      : side === 'right' && !compact
        ? Math.min(bottom - cardHeight / 2, height - 104)
        : bottom - cardHeight / 2
    const slots = Math.max(
      1,
      Math.floor((max - min) / (horizontal ? cardWidth + 16 : cardHeight)) + 1,
    )
    group.forEach((item, index) => {
      const row = index % slots
      const column = Math.floor(index / slots)
      const rowCount = Math.min(slots, group.length - column * slots)
      const along =
        rowCount === 1
          ? horizontal
            ? side === 'bottom'
              ? width * 0.66
              : width * 0.34
            : height / 2
          : min + (row * (max - min)) / (rowCount - 1)
      const x = horizontal
        ? along
        : side === 'left'
          ? left + column * (cardWidth + 14)
          : right - column * (cardWidth + 14)
      const y = horizontal
        ? side === 'top'
          ? top + column * cardHeight
          : bottom - column * cardHeight
        : along
      result.push({
        ...item,
        x: clamp(x, cardWidth / 2 + 12, width - cardWidth / 2 - 12),
        y: clamp(y, compact ? 24 : 32, height - (compact ? 28 : 44)),
        cardWidth,
      })
    })
  })
  return result
}
function compassSide(group, box, province = false) {
  if (!province) {
    if (Number(group.longitude) < 108) return 'left'
    if (Number(group.latitude) >= 36) return 'top'
    if (Number(group.latitude) <= 28) return 'bottom'
    return 'right'
  }
  const map = require('./atlas-map')
  const point = map.position(group.latitude, group.longitude)
  if (!point) return 'right'
  const dx = (point.x - box.x - box.width / 2) / box.width
  const dy = (point.y - box.y - box.height / 2) / box.height
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom'
}
function mapFrame(width, height, options = {}) {
  const sides = new Set(options.sides || [])
  const province = options.province && !options.album
  const compact = options.compact
  const pad = compact ? 12 : 16
  // Reserve a real band for each occupied province edge, including backing papers and labels.
  const left = province && sides.has('left') ? 84 : pad
  const right = province && sides.has('right') ? 84 : pad
  const top = province && sides.has('top') ? 76 : pad
  const bottom = province && sides.has('bottom') ? 76 : pad
  const availableW = Math.max(80, width - left - right)
  const availableH = Math.max(60, height - top - bottom)
  const scale = Math.min(
    availableW / (province ? 560 : 600),
    (availableH / (province ? 425 : 465)) * (province || options.album ? 1 : compact ? 1.06 : 1.4),
  )
  return {
    x: left + (availableW - 600 * scale) / 2,
    y: province || options.album ? top + (availableH - 465 * scale) / 2 : top - 12 * scale,
    width: 600 * scale,
    height: 465 * scale,
    scale,
    // Album bands only determine the initial map size/position, never its pan/zoom clipping.
    viewport: { x: 0, y: 0, width, height },
  }
}
module.exports = { placeCards, compassSide, mapFrame }
