const { request } = require('../../services/api')
const updates = require('../../services/updates')

function daysTogether(start) {
  if (!start) return 0
  const parts = start.split('-').map(Number),
    today = new Date(Date.now() + 8 * 3600000)
  const days =
    Math.round(
      (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
        Date.UTC(parts[0], parts[1] - 1, parts[2])) /
        86400000,
    ) + 1
  return Math.max(0, days)
}

Page({
  data: {
    couple: null,
    user: null,
    me: null,
    partner: null,
    days: 0,
    unreadCount: 0,
    loading: true,
    error: '',
    versionInfo: updates.snapshot(),
  },
  onShow() {
    this.stopVersionListener()
    this._stopVersionListener = updates.subscribe((versionInfo) => this.setData({ versionInfo }))
    this.load()
  },
  onHide() {
    this.stopVersionListener()
  },
  onUnload() {
    this.stopVersionListener()
  },
  stopVersionListener() {
    if (this._stopVersionListener) {
      this._stopVersionListener()
      this._stopVersionListener = null
    }
  },
  versionUpdate() {
    updates.open()
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      const user = wx.getStorageSync('user') || {}
      if (!user.coupleId) {
        this.setData({ user, couple: null, loading: false })
        return
      }
      const couple = await request({ url: '/api/couples/current' })
      const members = Array.isArray(couple.members) ? couple.members : []
      const self = members.find((member) => String(member.id) === String(user.id)) || user
      const other = members.find((member) => String(member.id) !== String(user.id)) || null
      const initial = (member) =>
        member
          ? String(member.nickname || '我')
              .trim()
              .charAt(0) || '我'
          : '?'
      const me = { ...self, initial: initial(self) }
      const partner = other ? { ...other, initial: initial(other) } : null
      let unreadCount = 0
      try {
        unreadCount = (await request({ url: '/api/notifications' })).unreadCount || 0
      } catch (_) {}
      this.setData({
        user,
        couple,
        me,
        partner,
        days: daysTogether(couple.anniversary),
        unreadCount,
        loading: false,
      })
    } catch (error) {
      this.setData({ error: error.message, loading: false })
    }
  },
  couple() {
    wx.navigateTo({ url: '/pages/couple/couple' })
  },
  profile() {
    wx.navigateTo({ url: '/pages/couple-settings/couple-settings' })
  },
  calendar() {
    wx.switchTab({ url: '/pages/calendar/calendar' })
  },
  atlas() {
    wx.switchTab({ url: '/pages/atlas/atlas' })
  },
  food() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },
  notifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },
  about() {
    wx.showModal({
      title: '我们的时光',
      content: '把吃饭、纪念日和旅行照片，放进只属于两个人的空间。',
      showCancel: false,
      confirmText: '知道啦',
    })
  },
})
