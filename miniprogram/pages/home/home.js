const api = require('../../services/life'),
  life = require('../../utils/life')
Page({
  data: { loading: true, error: '', needsCouple: false, summary: null, upcoming: [] },
  onShow() {
    this.load()
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      if (!wx.getStorageSync('user')?.coupleId) {
        this.setData({ needsCouple: true, loading: false })
        return
      }
      const summary = await api.summary()
      const target = (Math.floor((summary.togetherDays || 0) / 100) + 1) * 100
      this.setData({
        summary,
        milestoneTarget: target,
        milestoneDays: target - (summary.togetherDays || 0),
        milestoneProgress: ((summary.togetherDays || 0) / target) * 100,
        upcoming: summary.upcoming.slice(0, 3).map(life.event),
        loading: false,
        needsCouple: false,
      })
    } catch (e) {
      this.setData({ loading: false, error: e.message })
    }
  },
  open(e) {
    wx.switchTab({ url: e.currentTarget.dataset.url })
  },
  thoughtUnread(e) {
    this.setData({ thoughtUnreadCount: e.detail.count })
  },
  thoughts() {
    wx.navigateTo({ url: '/pages/thoughts/thoughts' })
  },
  editHome() {
    wx.navigateTo({ url: '/pages/home-edit/home-edit' })
  },
  couple() {
    wx.navigateTo({ url: '/pages/couple/couple' })
  },
  preview() {
    const p = this.data.summary.recentPhoto
    if (p) wx.previewImage({ urls: [p.originalUrl], current: p.originalUrl })
  },
})
