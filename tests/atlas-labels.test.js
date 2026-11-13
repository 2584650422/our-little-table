const test = require('node:test')
const assert = require('node:assert/strict')
const { layoutCityLabels } = require('../miniprogram/utils/atlas-labels')
const { bounds } = require('../miniprogram/utils/atlas-albums')
const provinces = require('../miniprogram/assets/atlas-provinces')
const cities = require('../miniprogram/assets/atlas-cities')
for (const [code, input] of Object.entries(cities)) {
  test(`province ${code}: all city names remain complete and inside the label frame at 1x and 3x`, () => {
    const province = provinces.find((p) => String(p.code) === code)
    const b = bounds(province.name)
    const zoom = Math.min(40, 540 / b.width, 405 / b.height)
    for (const gestureScale of [1, 3]) {
      const labels = layoutCityLabels(input, {
        zoom,
        tx: 300 - (b.x + b.width / 2) * zoom,
        ty: 232.5 - (b.y + b.height / 2) * zoom,
        scale: 0.5,
        width: 300,
        height: 232.5,
        gestureScale,
      })
      assert.equal(labels.length, input.length)
      for (let i = 0; i < labels.length; i++) {
        const l = labels[i]
        assert.equal(l.text.replace(/\n/g, ''), input[i].name)
        assert.ok(l.x - l.width / 2 >= 0 && l.x + l.width / 2 <= 300)
        assert.ok(l.y - l.height / 2 >= 0 && l.y + l.height / 2 <= 232.5)
        const font = Number(/font-size:([\d.]+)/.exec(l.style)[1])
        assert.ok(font * gestureScale <= 8.001)
        assert.ok(font * gestureScale >= 7)
      }
    }
  })
}
