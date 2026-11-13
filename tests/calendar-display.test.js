const test = require('node:test')
const assert = require('node:assert/strict')
const { lunarDate } = require('../miniprogram/utils/lunar')
function page() {
  let definition
  global.Page = (value) => {
    definition = value
  }
  const filename = require.resolve('../miniprogram/pages/calendar/calendar')
  delete require.cache[filename]
  require(filename)
  delete global.Page
  return {
    ...definition,
    data: structuredClone(definition.data),
    _events: [],
    setData(value) {
      Object.assign(this.data, value)
    },
  }
}
test('lunar dates match new year, new month and leap month boundaries', () => {
  for (const [solar, year, month, day, leap] of [
    ['2026-02-16', 2025, 12, 29, false],
    ['2026-02-17', 2026, 1, 1, false],
    ['2026-11-08', 2026, 9, 30, false],
    ['2026-11-09', 2026, 10, 1, false],
    ['2026-11-12', 2026, 10, 4, false],
    ['2023-03-22', 2023, 2, 1, true],
    ['2025-07-25', 2025, 6, 1, true],
    // HKO official tables; some ICU versions disagree on these future month boundaries.
    // https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2027e.txt
    // https://www.hko.gov.hk/en/gts/time/calendar/text/files/T2030e.txt
    ['2027-02-13', 2027, 1, 8, false],
    ['2030-02-13', 2030, 1, 11, false],
  ]) {
    const result = lunarDate(solar)
    assert.deepEqual([result.year, result.month, result.day, result.leap], [year, month, day, leap])
  }
  assert.equal(lunarDate('2026-11-09').label, '十月')
  assert.equal(lunarDate('2026-11-12').fullLabel, '农历十月初四 · 丙午年')
  assert.equal(lunarDate('2025-07-25').label, '闰六月')
  assert.equal(lunarDate('2026-02-30'), null)
  assert.equal(lunarDate('1899-01-01'), null)
})
test('offline lunar conversion agrees with independent Intl dates throughout 2020–2026', () => {
  const fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  })
  for (let y = 2020; y <= 2026; y++)
    for (let m = 1; m <= 12; m++) {
      const parts = Object.fromEntries(
        fmt.formatToParts(new Date(Date.UTC(y, m - 1, 13, 4))).map((p) => [p.type, p.value]),
      )
      const result = lunarDate(`${y}-${String(m).padStart(2, '0')}-13`)
      assert.equal(result.year, Number(parts.relatedYear))
      assert.equal(result.day, Number(parts.day))
      assert.equal(result.leap, parts.month.includes('闰'))
    }
})
test('all supported month boundaries convert to a valid lunar date', () => {
  for (let year = 1902; year <= 2097; year++)
    for (let month = 1; month <= 12; month++) {
      const result = lunarDate(`${year}-${String(month).padStart(2, '0')}-01`)
      assert.ok(
        result && result.month >= 1 && result.month <= 12 && result.day >= 1 && result.day <= 30,
      )
    }
})
test('selected day retains every record and the complete multiline content alongside lunar detail', () => {
  const p = page()
  const content = '一起走过熟悉的小路。\n' + '很多值得记住的小事。'.repeat(180)
  p.data.month = '2026-11'
  p._events = [
    { id: 1, nextDate: '2026-11-12', kind: 'diary', content },
    { id: 2, nextDate: '2026-11-12', kind: 'diary', content: '另一位的记录' },
    { id: 3, nextDate: '2026-11-13', kind: 'birthday' },
  ]
  p.select({ currentTarget: { dataset: { date: '2026-11-12' } } })
  assert.equal(p.data.dayEvents.length, 2)
  assert.equal(p.data.dayEvents[0].content, content)
  assert.equal(p.data.selectedLunar, '农历十月初四 · 丙午年')
  assert.equal(p.data.selectedTitle, '11月12日 · 星期四')
  assert.equal(p.data.cells.find((c) => c.day === 9).lunar, '十月')
  assert.equal(p.data.cells.find((c) => c.day === 9).lunarMonthStart, true)
})
test('selecting dates updates complete records without scrolling or measuring the viewport', () => {
  const p = page()
  p.data.month = '2026-11'
  p._events = [{ id: 1, nextDate: '2026-11-12', kind: 'diary', content: '完整记录\n第二段' }]
  let calls = 0
  global.wx = {
    pageScrollTo() {
      calls++
    },
    createSelectorQuery() {
      calls++
      throw Error('must not measure for auto scroll')
    },
    nextTick() {
      calls++
    },
  }
  try {
    p.select({ currentTarget: { dataset: { date: '2026-11-12' } } })
    assert.equal(p.data.dayEvents[0].content, '完整记录\n第二段')
    p.select({ currentTarget: { dataset: { date: '2026-11-13' } } })
    assert.equal(p.data.dayEvents.length, 0)
    assert.equal(calls, 0)
  } finally {
    delete global.wx
  }
})
