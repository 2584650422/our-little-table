const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function setup() {
  let definition, navigation
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/atlas/atlas.js', 'utf8'), {
    Page: (d) => {
      definition = d
    },
    require: (name) =>
      name.includes('atlas-albums') ? require('../miniprogram/utils/atlas-albums') : {},
    wx: {
      navigateTo: (options) => {
        navigation = options
      },
    },
  })
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(update) {
      Object.assign(this.data, update)
    },
  }
  return { page, navigation: () => navigation }
}
test('home edit passes the selected photo metadata to the edit page', () => {
  const state = setup()
  const photo = { id: 8, city: '北京', takenOn: '2020-01-01', caption: '旧随手记' }
  state.page.data.photos = [photo]
  state.page.edit({ currentTarget: { dataset: { id: '8' } } })
  let received
  state.navigation().success({
    eventChannel: {
      emit: (name, value) => {
        assert.equal(name, 'editPhoto')
        received = value
      },
    },
  })
  assert.equal(received, photo)
})
test('home carousel changes metadata with the image and resets when clearing the province', () => {
  const { page } = setup()
  const photos = [
    { id: 8, city: '北京', width: 3000, height: 2000 },
    { id: 9, city: '上海', width: 2000, height: 3000 },
  ]
  page.data.pins = photos
  page.data.storyPhotos = photos
  page.storyChange({ detail: { current: 1 } })
  assert.equal(page.data.selected.id, 9)
  assert.equal(page.data.storyIndex, 1)
  assert.equal(page.data.storyImageHeight, 820)
  page.clearProvinceFilter()
  assert.equal(page.data.selected.id, 8)
  assert.equal(page.data.storyIndex, 0)
})

test('album selection filters stories and highlights on the national board without hiding other albums', () => {
  const { page } = setup()
  const first = { id: 1, city: '北京', width: 3000, height: 2000 }
  const second = { id: 2, city: '四川', width: 3000, height: 2000 }
  const regions = [
    { id: '北京市', name: '北京市', count: 1, photos: [first] },
    { id: '四川省', name: '四川省', count: 1, photos: [second] },
  ]
  page._albums = { regions }
  page.data.groups = regions
  page.data.pins = [first, second]
  page.provinceSelect({ detail: { province: '四川省' } })
  assert.equal(page.data.highlightProvince, '')
  page.groupSelect({ detail: { id: '北京市' } })
  assert.equal(page.data.highlightProvince, '北京市')
  assert.equal(page.data.selected.id, 1)
  assert.equal(page.data.storyPhotos.length, 1)
  assert.equal(page.data.groups, regions)
  page.groupSelect({ detail: { id: '四川省' } })
  assert.equal(page.data.selected.id, 2)
  assert.equal(page.data.groups.length, 2)
  page.clearProvinceFilter()
  assert.equal(page.data.highlightProvince, '')
  assert.equal(page.data.storyPhotos.length, 2)
})
