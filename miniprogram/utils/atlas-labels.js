// Labels remain in map-local coordinates so native pan/inertia moves them with boundaries.
function layoutCityLabels(cities, options) {
  const { zoom, tx, ty, scale, width, height } = options
  const level = Math.max(1, options.gestureScale || 1)
  const font = (cities.length > 30 ? 7.5 : 8) / level
  const lineHeight = 10 / level
  const gap = 2 / level
  const placed = []
  return cities.map((city) => {
    const chars = Array.from(city.name)
    const lines = []
    const wrap = chars.length > 6 ? Math.ceil(chars.length / 2) : chars.length
    for (let i = 0; i < chars.length; i += wrap) lines.push(chars.slice(i, i + wrap).join(''))
    const labelWidth = Math.min(
      width - 2 * gap,
      Math.max(...lines.map((s) => Array.from(s).length)) * font + 2 / level,
    )
    const labelHeight = lines.length * lineHeight
    const anchorX = (city.point[0] * zoom + tx) * scale
    const anchorY = (city.point[1] * zoom + ty) * scale
    let best,
      bestCost = Infinity
    for (const distance of [0, 10, 18, 26, 36]) {
      for (const [dx, dy] of [
        [0, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const x = Math.max(
          labelWidth / 2 + gap,
          Math.min(width - labelWidth / 2 - gap, anchorX + (dx * distance) / level),
        )
        const y = Math.max(
          labelHeight / 2 + gap,
          Math.min(height - labelHeight / 2 - gap, anchorY + (dy * distance) / level),
        )
        const overlap = placed.reduce(
          (sum, r) =>
            sum +
            Math.max(0, (r.width + labelWidth) / 2 + gap - Math.abs(r.x - x)) *
              Math.max(0, (r.height + labelHeight) / 2 + gap - Math.abs(r.y - y)),
          0,
        )
        const cost = overlap * 10000 + Math.hypot(x - anchorX, y - anchorY)
        if (cost < bestCost) {
          bestCost = cost
          best = { x, y, width: labelWidth, height: labelHeight }
        }
      }
    }
    placed.push(best)
    const dx = best.x - anchorX,
      dy = best.y - anchorY
    return {
      name: city.name,
      text: lines.join('\n'),
      ...best,
      style: `left:${best.x}px;top:${best.y}px;width:${labelWidth}px;font-size:${font}px;line-height:${lineHeight}px;`,
      leaderStyle:
        Math.hypot(dx, dy) * level > 7
          ? `left:${anchorX}px;top:${anchorY}px;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad);`
          : '',
    }
  })
}
module.exports = { layoutCityLabels }
