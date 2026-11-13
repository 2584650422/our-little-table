const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
function page() {
  let definition
  const context = {
    Page: (value) => {
      definition = value
    },
    require: (name) =>
      name.includes('atlas-albums') ? require('../miniprogram/utils/atlas-albums') : {},
    wx: {},
    clearTimeout,
  }
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../miniprogram/pages/atlas-explore/atlas-explore.js'),
      'utf8',
    ),
    context,
  )
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) {
      Object.assign(this.data, update)
    },
  }
}
test('province -> single place -> original -> back preserves the selected place and province', () => {
  const p = page()
  p._photos = [
    { id: 3, city: '草原', latitude: 40.7, longitude: 111.8 },
    { id: 2, city: '草原', latitude: 40.7, longitude: 111.8 },
    { id: 1, city: '另一个地方', latitude: 40.8, longitude: 111.9 },
  ]
  p.rebuild()
  assert.equal(p.data.groups.length, 1)
  p.openProvince(p.data.groups[0].name)
  assert.equal(p.data.groups.length, 2)
  p.groupSelect({ detail: { id: 3 } })
  assert.equal(p.data.level, 'place')
  assert.deepEqual(
    p.data.photos.map((item) => item.id),
    [3, 2],
  )
  p.preview({ currentTarget: { dataset: { id: 2 } } })
  assert.equal(p.data.viewerOpen, true)
  assert.equal(p.data.photoIndex, 1)
  p.photoZoom({ detail: { scale: 2 } })
  assert.equal(p.data.photoZoomed, true)
  p.previousPhoto()
  assert.equal(p.data.photoIndex, 0)
  assert.equal(p.data.photoZoomed, false)
  p.nextPhoto()
  assert.equal(p.data.photoIndex, 1)
  p.nextPhoto()
  assert.equal(p.data.photoIndex, 1)
  p.choosePhoto({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(p.data.photoIndex, 0)
  p.back()
  assert.equal(p.data.viewerOpen, false)
  assert.equal(p.data.place.id, '3')
  p.back()
  assert.equal(p.data.level, 'province')
  assert.equal(p.data.groups.length, 2)
  p.back()
  assert.equal(p.data.level, 'country')
  assert.equal(p.data.groups.length, 1)
})

test('national selection exposes only that province places, and refresh preserves the selection', () => {
  const p = page()
  p._photos = [
    { id: 3, city: '地点一', latitude: 40.7, longitude: 111.8 },
    { id: 2, city: '地点二', latitude: 40.8, longitude: 111.9 },
    { id: 1, city: '北京', latitude: 39.9, longitude: 116.4 },
  ]
  p.rebuild()
  const region = p.data.groups.find((item) => item.name === '内蒙古自治区')
  p.groupSelect({ detail: { id: region.id } })
  assert.equal(p.data.level, 'province')
  assert.equal(p.data.groups.length, 2)
  p.rebuild()
  assert.equal(p.data.groups.length, 2)
  p.groupSelect({ detail: { id: p.data.groups[0].id } })
  assert.equal(p.data.level, 'place')
  p.back()
  const previous = p.data.province
  p.provinceSelect({ detail: { province: '北京市' } })
  assert.equal(p.data.province, previous)
  p.country()
  p.provinceSelect({ detail: { province: '内蒙古自治区' } })
  assert.equal(p.data.level, 'province')
  assert.equal(p.data.groups.length, 2)
})

test('national highlight is in national coordinates and split panel opening and closing restores the full map frame', () => {
  let definition
  const filename = path.join(__dirname, '../miniprogram/components/atlas-board/atlas-board.js')
  const componentRequire = require('node:module').createRequire(filename)
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Component: (d) => {
      definition = d
    },
    require: componentRequire,
  })
  const c = {
    ...definition.methods,
    properties: {
      groups: [],
      points: [],
      focus: '北京市',
      zoomed: false,
      album: false,
      compact: false,
    },
    data: { page: 0 },
    _rect: { width: 820, height: 320 },
    setData: (update) => Object.assign(c.data, update),
  }
  c.layout()
  c.draw('北京市')
  assert.equal(c.data.highlight, '/assets/atlas-maps/110000-compact.png')
  c.properties.zoomed = true
  c.layout()
  c.draw('北京市')
  assert.equal(c.data.highlight, '/assets/atlas-maps/110000-cities.png')
  const frame = c.data.frameStyle
  c.properties.album = true
  c.layout()
  assert.notEqual(c.data.frameStyle, frame)
  c.properties.album = false
  c.layout()
  assert.equal(c.data.frameStyle, frame)
  assert.ok(c.data.cityLabels.length > 0)
})

test('place photos fit landscape and portrait frames without cropping or side filler', () => {
  const p = page()
  p._photoBounds = { width: 420, height: 250 }
  for (const [width, height] of [
    [3840, 2160],
    [4000, 3000],
    [2000, 3000],
  ]) {
    p.data.photos = [{ width, height }]
    p.data.placePhotoIndex = 0
    p.fitPlacePhoto()
    assert.ok(Math.abs(p.data.photoFrameWidth / p.data.photoFrameHeight - width / height) < 0.00001)
    assert.ok(p.data.photoFrameWidth <= 410)
    assert.ok(p.data.photoFrameHeight <= 212)
    assert.ok(
      Math.abs(p.data.photoFrameWidth - 410) < 0.001 ||
        Math.abs(p.data.photoFrameHeight - 212) < 0.001,
    )
  }
})

test('failed original hides its broken layer and restores the preview fallback', () => {
  const p = page()
  const template = fs.readFileSync(
    path.join(__dirname, '../miniprogram/pages/atlas-explore/atlas-explore.wxml'),
    'utf8',
  )
  assert.match(
    template,
    /wx:if="\{\{!loadedPhotos\[item\.id\] \|\| failedPhotos\[item\.id\]\}\}" class="viewer-image" src="\{\{item\.previewUrl\}\}"/,
  )
  assert.match(
    template,
    /wx:if="\{\{!failedPhotos\[item\.id\]\}\}" class="viewer-image" src="\{\{item\.originalUrl\}\}"/,
  )
  p.originalFailed({ currentTarget: { dataset: { id: 12 } } })
  assert.equal(p.data['failedPhotos.12'], true)
  p.originalLoaded({ currentTarget: { dataset: { id: 12 } } })
  assert.equal(p.data['loadedPhotos.12'], true)
  assert.equal(p.data['failedPhotos.12'], false)
})
