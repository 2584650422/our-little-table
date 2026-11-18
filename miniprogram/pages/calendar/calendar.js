const api = require('../../services/life'),
  life = require('../../utils/life')
const thoughts = require('../../services/thoughts')
const { visibleUnread } = require('../../utils/thought-reading')
const { lunarDate } = require('../../utils/lunar')
Page({
  data: {
    month: life.date().slice(0, 7),
    selected: life.date(),
    week: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    dayEvents: [],
    upcoming: [],
    upcomingExpanded: true,
    thoughtDay: null,
    thoughtsOpen: false,
    thoughtError: false,
    error: '',
    summary: {},
    togetherLabel: '从哪一天开始？',
  },
  onShow() {
    this._visible = true
    this.loadThoughtMonth()
    this.loadThoughtDay()
    this._events = this._events || []
    this.draw()
    this.load()
  },
  async load() {
    const version = (this._version || 0) + 1
    this._version = version
    try {
      await getApp().loginPromise
      if (!life.requireCouple()) return
      const [summary, events] = await Promise.all([api.summary(), api.calendar(this.data.month)])
      if (version !== this._version) return
      this._events = events.map(life.event)
      this.setData({ summary, upcoming: summary.upcoming.map(life.event), error: '' })
      this.draw()
    } catch (e) {
      if (version === this._version) this.setData({ error: e.message })
    }
  },
  draw() {
    const [y, m] = this.data.month.split('-').map(Number),
      offset = (new Date(y, m - 1, 1).getDay() + 6) % 7,
      total = new Date(y, m, 0).getDate(),
      cells = Array.from({ length: offset }, (_, i) => ({ key: 'blank' + i }))
    for (let d = 1; d <= total; d++) {
      let dt = this.data.month + '-' + String(d).padStart(2, '0')
      const lunar = lunarDate(dt)
      cells.push({
        key: dt,
        date: dt,
        day: d,
        lunar: lunar?.label || '',
        lunarMonthStart: lunar?.day === 1,
        selected: dt === this.data.selected,
        marked: this._events.some((e) => e.nextDate === dt && e.kind !== 'diary'),
        diary: this._events.some((e) => e.nextDate === dt && e.kind === 'diary'),
        interaction: !!this._thoughtMonthCounts?.[dt],
      })
    }
    const selectedDate = new Date(
      Number(this.data.selected.slice(0, 4)),
      Number(this.data.selected.slice(5, 7)) - 1,
      Number(this.data.selected.slice(8)),
    )
    this.setData({
      cells,
      monthLabel: `${y}年${m}月`,
      selectedTitle: `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 · 星期${'日一二三四五六'[selectedDate.getDay()]}`,
      selectedLunar: lunarDate(this.data.selected)?.fullLabel || '',

      togetherLabel: life.togetherLabel(this.data.summary.anniversary, this.data.selected),
      dayEvents: this._events.filter((e) => e.nextDate === this.data.selected),
    })
  },
  move(e) {
    const [y, m] = this.data.month.split('-').map(Number)
    const dt = new Date(y, m - 1 + Number(e.currentTarget.dataset.delta), 1)
    if (dt.getFullYear() < 1902 || dt.getFullYear() > 2097) return
    const month = life.date(dt).slice(0, 7)
    this.setData({
      month,
      selected: month + '-01',
      togetherLabel: life.togetherLabel(this.data.summary.anniversary, month + '-01'),
    })
    this._events = []
    this._thoughtMonthCounts = {}
    this.draw()
    this.load()
    this.loadThoughtDay()
    this.loadThoughtMonth()
  },
  select(e) {
    if (!e.currentTarget.dataset.date) return
    this.setData({ selected: e.currentTarget.dataset.date })
    this.draw()
    this.loadThoughtDay()
  },
  onHide() {
    this._visible = false
    clearTimeout(this._thoughtReadTimer)
    this._thoughtVersion = (this._thoughtVersion || 0) + 1
    if (this.data.thoughtsOpen) wx.showTabBar()
    this.setData({ thoughtsOpen: false })
  },
  onUnload() {
    this.onHide()
  },
  async loadThoughtDay() {
    const version = (this._thoughtVersion = (this._thoughtVersion || 0) + 1)
    const date = this.data.selected
    this.setData({ thoughtDay: null, thoughtError: false, thoughtsOpen: false })
    try {
      await getApp().loginPromise
      const result = await thoughts.day(date)
      if (this._visible && version === this._thoughtVersion && date === this.data.selected)
        this.setData({ thoughtDay: this.groupThoughtDay(result) })
    } catch (_) {
      if (this._visible && version === this._thoughtVersion) this.setData({ thoughtError: true })
    }
  },
  async loadThoughtMonth() {
    const version = (this._thoughtMonthVersion = (this._thoughtMonthVersion || 0) + 1)
    const month = this.data.month
    try {
      await getApp().loginPromise
      const result = await thoughts.month(month)
      if (this._visible && version === this._thoughtMonthVersion && month === this.data.month) {
        this._thoughtMonthCounts = result.dates || {}
        this.draw()
      }
    } catch (_) {
      // Day details remain available even if the monthly marker request fails.
    }
  },
  groupThoughtDay(result) {
    const roots = new Map(
      result.items.filter((i) => !i.rootId).map((i) => [i.id, { ...i, replies: [] }]),
    )
    const threads = []
    result.items.forEach((item) => {
      if (!item.rootId) threads.push(roots.get(item.id))
      else if (roots.has(item.rootId)) roots.get(item.rootId).replies.push(item)
      else threads.push({ ...item, replies: [] })
    })
    return { ...result, threads }
  },
  showThoughtDay() {
    if (!this.data.thoughtDay?.items.length) return
    this.setData({ thoughtsOpen: true }, () => this.queueThoughtRead())
    wx.hideTabBar()
  },
  queueThoughtRead() {
    clearTimeout(this._thoughtReadTimer)
    this._thoughtReadTimer = setTimeout(() => this.markThoughtRead(), 120)
  },
  async markThoughtRead() {
    if (!this._visible || !this.data.thoughtsOpen || this._readingThoughts) return
    this._readingThoughts = true
    try {
      const result = this.data.thoughtDay
      const ids = await visibleUnread(
        this,
        '.thought-day-readable',
        result.items,
        '.thought-day-scroll',
      )
      if (!this._visible || !this.data.thoughtsOpen || !ids.length) return
      await thoughts.read(ids.slice(0, 200))
      const read = new Set(ids.slice(0, 200))
      if (this.data.thoughtDay === result)
        this.setData({
          thoughtDay: this.groupThoughtDay({
            ...result,
            items: result.items.map((i) => (read.has(i.id) ? { ...i, readAt: '已查看' } : i)),
          }),
        })
    } catch (_) {
    } finally {
      this._readingThoughts = false
    }
  },
  closeThoughtDay() {
    this.setData({ thoughtsOpen: false })
    wx.showTabBar()
  },
  viewThoughts(e) {
    const id = e.currentTarget.dataset.id || this.data.thoughtDay?.items[0]?.id
    this.closeThoughtDay()
    wx.navigateTo({ url: '/pages/thoughts/thoughts' + (id ? '?focusId=' + id : '') })
  },
  noop() {},
  toggleUpcoming() {
    this.setData({ upcomingExpanded: !this.data.upcomingExpanded })
  },
  add() {
    wx.navigateTo({ url: '/pages/life-edit/life-edit?kind=important&date=' + this.data.selected })
  },
  avatarError(e) {
    const id = e.currentTarget.dataset.id
    this._events = this._events.map((item) =>
      item.id === id ? { ...item, creatorAvatarUrl: null } : item,
    )
    this.draw()
  },
  addDiary() {
    wx.navigateTo({ url: '/pages/life-edit/life-edit?kind=diary&date=' + this.data.selected })
  },
  start() {
    wx.navigateTo({ url: '/pages/life-edit/life-edit?type=start' })
  },
  async edit(e) {
    const id = e.currentTarget.dataset.id
    if (String(id).startsWith('milestone') || id === 'anniversary') {
      this.start()
      return
    }
    const choices = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['编辑这个日子', '删除这个日子'],
        success: resolve,
        fail: () => resolve(null),
      }),
    )
    if (!choices) return
    if (choices.tapIndex === 0) {
      wx.navigateTo({ url: '/pages/life-edit/life-edit?id=' + id })
      return
    }
    const result = await new Promise((resolve) =>
      wx.showModal({
        title: '删除这个日子？',
        content: '双方的日历都会移除这条记录。',
        success: resolve,
      }),
    )
    if (result.confirm)
      try {
        await api.deleteEvent(id)
        this.load()
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' })
      }
  },
})
