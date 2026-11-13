const api = require('../../services/life'),
  life = require('../../utils/life')
const kindValues = ['countdown', 'birthday', 'anniversary', 'diary']
const years = Array.from({ length: 198 }, (_, i) => 1901 + i),
  months = Array.from({ length: 12 }, (_, i) => i + 1),
  days = Array.from({ length: 30 }, (_, i) => i + 1)
const lunarMonths = [
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
const lunarDays = [
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
const lunarText = (year, month, day, leap = false) =>
  `${year}年 ${leap ? '闰' : ''}${lunarMonths[month - 1]}${lunarDays[day - 1]}`
Page({
  data: {
    type: 'event',
    today: life.date(),
    title: '',
    content: '',
    eventDate: life.date(),
    kindIndex: 3,
    calendarIndex: 0,
    reminderIndex: 3,
    importantKinds: ['倒数日 · 某一天', '生日 · 每年重复', '纪念日 · 每年重复'],
    kinds: ['倒数日 · 某一天', '生日 · 每年重复', '纪念日 · 每年重复', '当天记录 · 记下发生的事'],
    calendars: ['公历', '农历'],
    lunarRanges: [years.map((y) => y + '年'), lunarMonths, lunarDays],
    lunarIndex: [new Date().getFullYear() - 1901, 0, 0],
    lunarLabel: lunarText(new Date().getFullYear(), 1, 1),
    lunarLeap: false,
    reminders: ['当天', '提前 1 天', '提前 3 天', '提前 7 天', '提前 14 天', '提前 30 天'],
    saving: false,
    error: '',
  },
  async onLoad(q) {
    this.setData({
      type: q.type || 'event',
      id: q.id || '',
      kindIndex: q.kind === 'important' ? 0 : 3,
      eventDate: q.date || life.date(),
    })
    try {
      if (q.type === 'start') {
        const s = await api.summary()
        this.setData({ eventDate: s.anniversary || life.date() })
      } else if (q.id) {
        const e = (await api.events()).find((e) => String(e.id) === q.id)
        if (e) {
          this.setData({
            title: e.title,
            content: e.content || '',
            eventDate: e.eventDate,
            kindIndex: kindValues.indexOf(e.kind),
            calendarIndex: e.calendarType === 'lunar' ? 1 : 0,
            reminderIndex: [0, 1, 3, 7, 14, 30].indexOf(e.remindDays),
          })
          if (e.lunarDate) {
            const d = e.lunarDate
            this.setData({
              lunarIndex: [d.year - 1901, d.month - 1, d.day - 1],
              lunarLabel: lunarText(d.year, d.month, d.day, d.leap),
              lunarLeap: d.leap,
            })
          }
        }
      }
    } catch (e) {
      this.setData({ error: e.message })
    }
  },
  field(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
    if (field === 'lunarLeap') {
      const i = this.data.lunarIndex
      this.setData({ lunarLabel: lunarText(years[i[0]], months[i[1]], days[i[2]], e.detail.value) })
    }
  },
  lunar(e) {
    const i = e.detail.value
    this.setData({
      lunarIndex: i,
      lunarLabel: lunarText(years[i[0]], months[i[1]], days[i[2]], this.data.lunarLeap),
    })
  },
  async save() {
    if (this.data.saving) return
    this.setData({ saving: true, error: '' })
    try {
      if (this.data.type === 'start') await api.anniversary(this.data.eventDate)
      else {
        const d = this.data,
          kind = kindValues[Number(d.kindIndex)],
          lunar = kind !== 'diary' && Number(d.calendarIndex) === 1,
          i = d.lunarIndex
        await api.saveEvent(
          {
            title: d.title,
            content: d.content,
            eventDate: d.eventDate,
            kind,
            calendarType: lunar ? 'lunar' : 'solar',
            ...(lunar
              ? {
                  lunarDate: {
                    year: years[i[0]],
                    month: months[i[1]],
                    day: days[i[2]],
                    leap: d.lunarLeap,
                  },
                }
              : {}),
            remindDays: kind === 'diary' ? 0 : [0, 1, 3, 7, 14, 30][Number(d.reminderIndex)],
          },
          d.id,
        )
      }
      wx.navigateBack()
    } catch (e) {
      this.setData({ error: e.message })
    } finally {
      this.setData({ saving: false })
    }
  },
})
