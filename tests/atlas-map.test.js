const test=require('node:test')
const assert=require('node:assert/strict')
const {position}=require('../miniprogram/utils/atlas-map')

test('旅行地点与原型地图的城市标记对齐',()=>{
  for(const [lat,lng,x,y] of [
    [39.904989,116.405285,387.9765,157.9501],
    [30.659462,104.065735,298.3048,240.4351],
    [30.287459,120.153576,415.2154,243.5717]
  ]){
    const pin=position(lat,lng)
    assert.ok(pin)
    // position returns projected anchors; thumbnail displacement is handled by layoutPins.
    assert.ok(Math.abs(pin.x-x)<0.012)
    assert.ok(Math.abs(pin.y-y)<0.01)
  }
})

test('无效坐标不会生成地图标记',()=>{
  assert.equal(position(90,120),null)
  assert.equal(position('not-a-latitude',120),null)
})
