const test = require('node:test')
const assert = require('node:assert/strict')
const { albums, bounds } = require('../miniprogram/utils/atlas-albums')
const photo = (id, city, latitude, longitude) => ({ id, city, latitude, longitude, previewUrl: 'preview-' + id })
test('same POI photographs merge across dates, nearby distinct POIs stay separate', () => {
  const result = albums([photo(3,'青城山',30.9,103.5), photo(2,'青城山',30.9002,103.5002), photo(1,'成都',30.65,104.06)])
  assert.equal(result.regions.length,1)
  assert.equal(result.regions[0].name,'四川省')
  assert.equal(result.regions[0].count,3)
  assert.equal(result.places.length,2)
  assert.equal(result.places[0].count,2)
  assert.deepEqual(result.places[0].photos.map(p=>p.id),[3,2])
})
test('identically named distant POIs do not merge; unlocated photos are omitted from map only', () => {
  const input = [photo(3,'公园',39.90,116.4),photo(2,'公园',30.65,104.06),photo(1,'旧照片',null,null)]
  const result=albums(input)
  assert.equal(result.regions.length,2)
  assert.equal(result.places.length,2)
  assert.equal(input.length,3)
})
test('a province focus bounds contains known visited coordinates', () => {
  const map=require('../miniprogram/utils/atlas-map')
  const point=map.position(30.65,104.06), box=bounds('四川省')
  assert.ok(point.x>=box.x && point.x<=box.x+box.width)
  assert.ok(point.y>=box.y && point.y<=box.y+box.height)
  assert.ok(box.width>0 && box.height>0)
})


test('照片按记录日期倒序，同一天按ID倒序，地点封面使用最新记录', () => {
  const { albums, sortPhotos } = require('../miniprogram/utils/atlas-albums')
  const photos = [
    { id: 99, takenOn: '2020-01-01', city: '成都', latitude: 30.67, longitude: 104.06 },
    { id: 2, takenOn: '2026-11-18', city: '成都', latitude: 30.67, longitude: 104.06 },
    { id: 3, takenOn: '2026-11-18', city: '成都', latitude: 30.67, longitude: 104.06 },
  ]
  assert.deepEqual(sortPhotos(photos).map(p => p.id), [3, 2, 99])
  assert.equal(photos[0].id, 99)
  assert.deepEqual(albums(photos).places[0].photos.map(p => p.id), [3, 2, 99])
})
