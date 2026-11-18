const test = require('node:test')
const assert = require('node:assert/strict')
const { placeCards } = require('../miniprogram/utils/atlas-layout')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
test('board keeps geographic edges and stable ordered slots across pan and zoom', () => {
  const items = [
    { group: { id: 'west' }, side: 'left', order: 120, ax: 200, ay: 150 },
    { group: { id: 'north-west' }, side: 'top', order: 310, ax: 310, ay: 100 },
    { group: { id: 'north-east' }, side: 'top', order: 370, ax: 370, ay: 110 },
    { group: { id: 'south' }, side: 'bottom', order: 350, ax: 350, ay: 220 },
    { group: { id: 'east' }, side: 'right', order: 140, ax: 420, ay: 140 },
  ]
  const cards = placeCards(items, 820, 320, { zoomed: true })
  const byId = Object.fromEntries(cards.map((c) => [c.group.id, c]))
  assert.ok(byId.west.x < byId.east.x)
  assert.ok(byId['north-west'].x < byId['north-east'].x)
  assert.ok(byId['north-west'].y < byId.south.y)
  const moved = placeCards(
    items.map((c) => ({ ...c, ax: c.ax * 3 - 900, ay: c.ay * 3 - 400 })),
    820,
    320,
    { zoomed: true },
  )
  assert.deepEqual(
    moved.map((c) => [c.group.id, c.x, c.y]),
    cards.map((c) => [c.group.id, c.x, c.y]),
  )
  for (const card of cards) {
    assert.equal(card.cardWidth, 56)
    assert.ok(card.x >= 44 && card.x <= 776)
    assert.ok(card.y >= 32 && card.y <= 276)
    assert.ok(!(card.x - 34 < 144 && card.y - 24 < 48))
  }
})
test('zoom and pan move connector anchors without scaling cards or sending them outside the viewport', () => {
  let definition
  const filename = path.resolve('miniprogram/components/atlas-board/atlas-board.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Component: (d) => {
      definition = d
    },
    require: require('node:module').createRequire(filename),
  })
  const c = {
    ...definition.methods,
    properties: {
      groups: [{ id: 1, name: '北京', latitude: 39.9, longitude: 116.4, photos: [] }],
      points: [],
      compact: false,
      zoomed: false,
    },
    data: { page: 0 },
    _rect: { width: 820, height: 320 },
    setData(update) {
      Object.assign(this.data, update)
    },
  }
  c.layout()
  const first = c.data.lines[0].ax
  const cardStyle = c.data.cards[0].style
  const markerStyle = c.data.markers[0].style
  const template = fs.readFileSync(filename.replace(/\.js$/, '.wxml'), 'utf8')
  assert.match(template, /<movable-view[\s\S]*wx:for="\{\{markers\}\}"[\s\S]*<\/movable-view>/)
  c._gesture = { scale: 2, x: -40, y: 0 }
  c.layout()
  assert.notEqual(c.data.lines[0].ax, first)
  assert.equal(c.data.markers[0].style, markerStyle)
  assert.equal(c.data.markerScale, 0.5)
  assert.equal(c.data.cards[0].style, cardStyle)
  assert.match(c.data.cards[0].style, /width:56px/)
  c._gesture = { scale: 3, x: -120, y: -20 }
  c.layout()
  assert.match(c.data.cards[0].style, /width:56px/)
  assert.ok(c.data.cards.length === 1)
  assert.equal(c.data.cards[0].style, cardStyle)
  c._rect.left = 10
  c._rect.top = 20
  c._stageRect = { left: -30, top: 5, width: 984, height: 384 }
  c.layout()
  assert.ok(Math.abs(c.data.lines[0].ax - (first * 1.2 - 40)) < 0.001)
  assert.equal(c.data.cards[0].style, cardStyle)
})

test('full and compact albums sit against the outer green board edges', () => {
  for (const compact of [false, true]) {
    const width = compact ? 340 : 820,
      height = compact ? 220 : 320
    const cards = placeCards(
      ['left', 'right', 'top', 'bottom'].map((side) => ({ side })),
      width,
      height,
      { compact },
    )
    const find = (side) => cards.find((c) => c.side === side)
    assert.ok(find('left').x < width * 0.12)
    assert.ok(find('right').x > width * 0.88)
    assert.ok(find('top').y < height * 0.15)
    assert.ok(find('bottom').y > height * 0.8)
  }
})

test('national compass matches the approved Sichuan, Inner Mongolia, Beijing and Guangdong layout', () => {
  const { compassSide } = require('../miniprogram/utils/atlas-layout')
  for (const [latitude, longitude, side] of [
    [30.65, 104.06, 'left'],
    [40.7, 111.8, 'top'],
    [39.9, 116.4, 'top'],
    [23.1, 113.3, 'bottom'],
  ]) {
    assert.equal(compassSide({ latitude, longitude }, {}, false), side)
  }
})
test('Inner Mongolia initial map leaves an album gap while pan and zoom use the entire board', () => {
  const { compassSide, mapFrame } = require('../miniprogram/utils/atlas-layout')
  const { bounds } = require('../miniprogram/utils/atlas-albums')
  const group = { latitude: 40.7, longitude: 111.8 }
  const side = compassSide(group, bounds('内蒙古自治区'), true)
  assert.equal(side, 'bottom')
  for (const [width, height] of [
    [820, 304],
    [700, 280],
    [920, 340],
  ]) {
    const frame = mapFrame(width, height, { province: true, sides: [side] })
    const card = placeCards([{ side }], width, height)[0]
    assert.ok(
      frame.y + frame.height - 30 * frame.scale <= card.y - 28,
      'province outline and backing papers have a real gap',
    )
    assert.deepEqual(frame.viewport, { x: 0, y: 0, width, height })
  }
})

test('city names stay in map-local coordinates and share the native movable layer', () => {
  let definition
  const filename = path.resolve('miniprogram/components/atlas-board/atlas-board.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Component: (d) => {
      definition = d
    },
    require: require('node:module').createRequire(filename),
  })
  const c = {
    ...definition.methods,
    properties: { groups: [], points: [], compact: false, zoomed: true, focus: '内蒙古自治区' },
    data: { page: 0 },
    _rect: { left: 10, top: 20, width: 820, height: 320 },
    setData(update) {
      Object.assign(this.data, update)
    },
  }
  c.layout()
  c._gesture = { scale: 3, x: 0, y: 0 }
  c.layout()
  const original = JSON.stringify(c.data.cityLabels)
  assert.ok(c.data.cityLabels.length > 0)
  c._gesture = { scale: 3, x: -250, y: -160 }
  c._stageRect = { left: -240, top: -140, width: 2460, height: 960 }
  c.layout()
  assert.equal(
    JSON.stringify(c.data.cityLabels),
    original,
    'native transform moves labels; JS must not project them again',
  )
  const wxml = fs.readFileSync('miniprogram/components/atlas-board/atlas-board.wxml', 'utf8')
  const stage = wxml.slice(wxml.indexOf('<movable-view'), wxml.indexOf('</movable-view>'))
  assert.match(stage, /class="city-label\b/)
  const overlay = wxml.slice(wxml.indexOf('<view class="photos'))
  assert.doesNotMatch(overlay, /class="city-label\b/)
})

test('province viewport never introduces photo-dependent inner rectangular clipping', () => {
  const { mapFrame } = require('../miniprogram/utils/atlas-layout')
  for (const sides of [
    [],
    ['top'],
    ['bottom'],
    ['left', 'right'],
    ['top', 'right', 'bottom', 'left'],
  ]) {
    for (const album of [false, true]) {
      const frame = mapFrame(820, 320, { province: true, album, sides })
      assert.deepEqual(frame.viewport, { x: 0, y: 0, width: 820, height: 320 })
    }
  }
})

test('省份城市超过六个时仍在同一页显示所有照片堆', () => {
  let definition
  const filename = path.resolve('miniprogram/components/atlas-board/atlas-board.js')
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Component: d => { definition = d }, require: require('node:module').createRequire(filename),
  })
  const groups = Array.from({ length: 12 }, (_, i) => ({
    id: `city:${i}`, name: `城市${i}`, latitude: 30 + i * 0.05,
    longitude: 104 + i * 0.05, photos: [], count: 1,
  }))
  const c = {
    ...definition.methods,
    properties: { groups, points: [], compact: false, zoomed: true, focus: '四川省' },
    data: { page: 1 }, _rect: { width: 820, height: 320 },
    setData(values) { Object.assign(this.data, values) },
  }
  c.layout()
  assert.equal(c.data.pages, 1)
  assert.equal(c.data.page, 0)
  assert.equal(c.data.cards.length, 12)
})
