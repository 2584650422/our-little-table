const map = require('../../utils/atlas-map')
const cityMaps = require('../../assets/atlas-cities')
const { layoutCityLabels } = require('../../utils/atlas-labels')
const { bounds } = require('../../utils/atlas-albums')
const { placeCards, compassSide, mapFrame } = require('../../utils/atlas-layout')

function segmentsCross(a, b) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const a1 = { x: a.ax, y: a.ay },
    a2 = { x: a.x, y: a.y },
    b1 = { x: b.ax, y: b.ay },
    b2 = { x: b.x, y: b.y }
  const ab1 = cross(a1, a2, b1),
    ab2 = cross(a1, a2, b2),
    ba1 = cross(b1, b2, a1),
    ba2 = cross(b1, b2, a2)
  return ab1 * ab2 < 0 && ba1 * ba2 < 0
}

Component({
  properties: {
    groups: { type: Array, value: [] },
    focus: { type: String, value: '' },
    zoomed: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    album: { type: Boolean, value: false },
    points: { type: Array, value: [] },
  },
  data: {
    base: '/assets/atlas-maps/country.png',
    highlight: '',
    cards: [],
    lines: [],
    markers: [],
    cityLabels: [],
    page: 0,
    pages: 1,
    imageStyle: '',
    frameStyle: '',
    scale: 1,
    x: 0,
    y: 0,
    fading: false,
    ready: false,
  },
  observers: {
    'groups, focus, album, zoomed, points': function () {
      if (this._ready) this.refresh()
    },
  },
  lifetimes: {
    ready() {
      this._ready = true
      this._views = {}
      this._timers = []
      this.measure()
      this.draw(this.properties.focus)
    },
    detached() {
      this._ready = false
      clearTimeout(this._layoutTimer)
      ;(this._timers || []).forEach(clearTimeout)
    },
  },
  methods: {
    measure() {
      this.createSelectorQuery()
        .select('.board')
        .boundingClientRect()
        .exec((items) => {
          if (!items[0] || !this._ready) return
          this._rect = items[0]
          this._stageRect = null
          this.layout()
          this.scheduleLayout()
        })
    },
    refresh() {
      this.setData({ fading: true })
      const epoch = (this._epoch = (this._epoch || 0) + 1)
      this._timers.push(
        setTimeout(() => {
          if (!this._ready || epoch !== this._epoch) return
          const key =
            (this.properties.zoomed ? this.properties.focus : 'country') +
            (this.properties.album ? ':album' : '')
          if (this._focusKey !== key) {
            if (this._focusKey)
              this._views[this._focusKey] = {
                ...(this._gesture || { scale: 1, x: 0, y: 0 }),
                page: this.data.page,
              }
            const view = this._views[key] || { scale: 1, x: 0, y: 0, page: 0 }
            this._stageRect = null
            this._gesture = { ...view }
            this.setData(view)
            this._focusKey = key
          }
          this.draw(this.properties.focus)
          this.measure()
        }, 0),
      )
    },
    layout() {
      if (!this._rect) return
      const w = this._rect.width * (this.properties.album ? 0.42 : 1)
      const h = this._rect.height
      const compact = this.properties.compact
      const provinceView = this.properties.zoomed && this.properties.focus && !compact
      const box = provinceView
        ? bounds(this.properties.focus)
        : { x: 0, y: 0, width: 600, height: 465 }
      const groups = this.properties.groups || []
      const capacity = compact ? 4 : 6
      const pages = Math.max(1, Math.ceil(groups.length / capacity))
      const page = Math.min(this.data.page, pages - 1)
      const visible = groups.slice(page * capacity, (page + 1) * capacity)
      const frame = mapFrame(w, h, {
        compact,
        album: this.properties.album,
        province: provinceView,
        sides: visible.map((group) => compassSide(group, box, provinceView)),
      })
      const viewport = frame.viewport
      const inViewport = (x, y) =>
        x >= viewport.x &&
        x <= viewport.x + viewport.width &&
        y >= viewport.y &&
        y <= viewport.y + viewport.height
      const scale = frame.scale
      const mw = frame.width,
        mh = frame.height,
        fx = frame.x,
        fy = frame.y
      const zoom =
        this.properties.zoomed && this.properties.focus && !compact
          ? Math.min(40, Math.min(540 / Math.max(box.width, 1), 405 / Math.max(box.height, 1)))
          : 1
      const tx = 300 - (box.x + box.width / 2) * zoom
      const ty = 232.5 - (box.y + box.height / 2) * zoom
      const cards = [],
        lineCandidates = [],
        markers = []
      for (const pointPhoto of this.properties.points || []) {
        const point = map.position(pointPhoto.latitude, pointPhoto.longitude)
        if (!point) continue
        const px = fx + (point.x * zoom + tx) * scale
        const py = fy + (point.y * zoom + ty) * scale
        markers.push({
          id: pointPhoto.id,
          label: pointPhoto.city || pointPhoto.name || '',
          style: `left:${px}px;top:${py}px;`,
        })
      }
      const gesture = this._gesture || { scale: 1, x: 0, y: 0 }
      const rendered = this._stageRect
      const project = (px, py) =>
        rendered
          ? {
              x: rendered.left - this._rect.left + (px * rendered.width) / w,
              y: rendered.top - this._rect.top + (py * rendered.height) / h,
            }
          : {
              x: (px - w / 2) * gesture.scale + w / 2 + (gesture.x || 0),
              y: (py - h / 2) * gesture.scale + h / 2 + (gesture.y || 0),
            }
      const positioned = []
      visible.forEach((group) => {
        const point = map.position(group.latitude, group.longitude)
        if (!point) return
        const baseX = fx + (point.x * zoom + tx) * scale
        const baseY = fy + (point.y * zoom + ty) * scale
        const anchor = project(baseX, baseY)
        const ax = anchor.x
        const ay = anchor.y
        const side = compassSide(group, box, provinceView)
        positioned.push({
          group,
          ax,
          ay,
          side,
          order: side === 'top' || side === 'bottom' ? baseX : baseY,
        })
      })
      for (const item of placeCards(positioned, w, h, {
        compact,
        zoomed: this.properties.zoomed,
      })) {
        const dx = item.x - item.ax,
          dy = item.y - item.ay
        cards.push({
          ...item.group,
          edge: item.side,
          style: `left:${item.x}px;top:${item.y}px;width:${item.cardWidth}px;`,
          back: item.group.photos[1]?.previewUrl || item.group.previewUrl,
        })
        if (inViewport(item.ax, item.ay))
          lineCandidates.push({
            ...item,
            id: item.group.id,
            length: Math.hypot(dx, dy),
            style: `left:${item.ax}px;top:${item.ay}px;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad);`,
          })
      }
      const lines = []
      lineCandidates
        .sort((a, b) => a.length - b.length)
        .forEach((candidate) => {
          if (!lines.some((line) => segmentsCross(line, candidate))) lines.push(candidate)
        })
      const province = map.provinces.find((item) => item.name === this.properties.focus)
      const cityLabels =
        this.properties.zoomed && province
          ? layoutCityLabels(cityMaps[province.code] || [], {
              zoom,
              tx,
              ty,
              scale,
              width: mw,
              height: mh,
              gestureScale: rendered ? rendered.width / w : gesture.scale,
            })
          : []
      for (const marker of markers) {
        const match = /left:([\d.-]+)px;top:([\d.-]+)px/.exec(marker.style)
        if (match) {
          const point = project(Number(match[1]), Number(match[2]))
          marker.style = `left:${point.x}px;top:${point.y}px;`
        }
      }
      this.setData({
        cityLabels,
        cards,
        lines,
        markers: markers.filter((marker) => {
          const match = /left:([\d.-]+)px;top:([\d.-]+)px/.exec(marker.style)
          return match && inViewport(Number(match[1]), Number(match[2]))
        }),
        clipStyle: `left:${viewport.x}px;top:${viewport.y}px;width:${viewport.width}px;height:${viewport.height}px;`,
        areaStyle: `left:${-viewport.x}px;top:${-viewport.y}px;width:${w}px;height:${h}px;`,
        pages,
        page,
        fading: false,
        ready: true,
        frameStyle: `left:${fx}px;top:${fy}px;width:${mw}px;height:${mh}px;`,
        imageStyle: `transform:translate(${tx * scale}px,${ty * scale}px) scale(${zoom});`,
      })
    },
    draw(focus) {
      const province = map.provinces.find((item) => item.name === focus)
      this.setData({
        highlight: province
          ? `/assets/atlas-maps/${province.code}${!this.properties.zoomed || this.properties.compact ? '-compact' : cityMaps[province.code] ? '-cities' : ''}.png`
          : '',
      })
    },
    groupTap(event) {
      this.triggerEvent('groupselect', { id: event.currentTarget.dataset.id })
    },
    mapTap(event) {
      if (this.properties.compact || this.properties.zoomed) return
      const touch = event.changedTouches?.[0]
      if (!touch) return
      this.createSelectorQuery()
        .select('#map-surface')
        .boundingClientRect()
        .exec((items) => {
          const rect = items[0]
          if (!rect?.width) return
          const province = map.provinceAt(
            ((touch.clientX - rect.left) / rect.width) * 600,
            ((touch.clientY - rect.top) / rect.height) * 465,
          )
          if (province) this.triggerEvent('provinceselect', { province })
        })
    },
    scheduleLayout() {
      if (this._layoutTimer) return
      this._layoutTimer = setTimeout(() => {
        this._layoutTimer = null
        if (!this._ready) return
        this.createSelectorQuery()
          .select('.stage')
          .boundingClientRect()
          .exec((rects) => {
            if (!this._ready) return
            this._stageRect = rects[0] || null
            this.layout()
          })
      }, 16)
    },
    scaleChange(event) {
      this._gesture = { ...(this._gesture || { x: 0, y: 0 }), scale: event.detail.scale }
      this.scheduleLayout()
    },
    moveChange(event) {
      this._gesture = { ...(this._gesture || { scale: 1 }), x: event.detail.x, y: event.detail.y }
      this.scheduleLayout()
    },
    zoom(event) {
      const current = this._gesture || { scale: 1, x: 0, y: 0 }
      const scale = Math.max(
        1,
        Math.min(3, current.scale + Number(event.currentTarget.dataset.delta)),
      )
      this._gesture = { ...current, scale }
      this.setData({ scale })
      this.scheduleLayout()
    },
    reset() {
      this._gesture = { scale: 1, x: 0, y: 0 }
      this.setData(this._gesture)
      this.scheduleLayout()
    },
    previous() {
      this.setData({ page: Math.max(0, this.data.page - 1) }, () => this.layout())
    },
    next() {
      this.setData({ page: Math.min(this.data.pages - 1, this.data.page + 1) }, () => this.layout())
    },
    resize() {
      this.measure()
    },
  },
})
