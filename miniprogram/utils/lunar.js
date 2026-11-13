// Offline conversion: does not depend on device Intl support, timezone or network.
const years = require('../assets/lunar-years')
const months = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '腊月',
]
const days = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
]
function lunarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const [y, m, d] = value.split('-').map(Number)
  const stamp = Date.UTC(y, m - 1, d)
  const parsed = new Date(stamp)
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d)
    return null
  const ordinal = stamp / 86400000
  let low = 0,
    high = years.length - 1,
    index = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (years[mid][0] <= ordinal) {
      index = mid
      low = mid + 1
    } else high = mid - 1
  }
  if (index < 0) return null
  const [start, leapMonth, bits] = years[index]
  let remaining = ordinal - start,
    bit = 0
  for (let month = 1; month <= 12; month++) {
    for (const leap of leapMonth === month ? [false, true] : [false]) {
      const length = 29 + ((bits >> bit++) & 1)
      if (remaining < length) {
        const year = index + 1900,
          day = remaining + 1
        const monthName = (leap ? '闰' : '') + months[month - 1]
        const dayName = days[day - 1]
        const yearName =
          '甲乙丙丁戊己庚辛壬癸'[(year - 4) % 10] +
          '子丑寅卯辰巳午未申酉戌亥'[(year - 4) % 12] +
          '年'
        return {
          year,
          month,
          day,
          leap,
          monthName,
          dayName,
          label: day === 1 ? monthName : dayName,
          fullLabel: `农历${monthName}${dayName} · ${yearName}`,
        }
      }
      remaining -= length
    }
  }
  return null
}
module.exports = { lunarDate }
