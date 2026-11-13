const { request } = require('../../services/api'),
  cart = require('../../utils/cart')
Page({
  data: {
    mode: 'create',
    name: '我们的时光',
    inviteCode: '',
    nickname: '',
    created: null,
    couples: [],
    loading: true,
    error: '',
  },
  onShow() {
    this.load()
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      const user = wx.getStorageSync('user') || {},
        result = await request({ url: '/api/couples/mine' })
      const couples = result.map((item) => ({
        ...item,
        hasLeft: !!item.hasLeft,
        isCurrent: !!item.isCurrent,
      }))
      this.setData({
        nickname: user.nickname === '新朋友' ? '' : user.nickname || '',
        couples,
        loading: false,
      })
    } catch (e) {
      this.setData({ loading: false, error: e.message || '空间加载失败，请重试' })
      wx.showToast({ title: e.message, icon: 'none' })
    }
  },
  mode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode })
  },
  input(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value })
  },
  async saveNickname() {
    if (!this.data.nickname.trim()) return
    const user = await request({
      url: '/api/auth/me',
      method: 'PUT',
      data: { nickname: this.data.nickname.trim() },
    })
    wx.setStorageSync('user', user)
    getApp().globalData.user = user
  },
  async submit() {
    try {
      await this.saveNickname()
      if (this.data.mode === 'create') {
        const created = await request({
          url: '/api/couples',
          method: 'POST',
          data: { name: this.data.name },
          loading: true,
          error: '',
        })
        cart.clear()
        this.setData({ created })
        const user = await request({ url: '/api/auth/me' })
        wx.setStorageSync('user', user)
        getApp().globalData.user = user
        this.load()
      } else {
        await request({
          url: '/api/couples/join',
          method: 'POST',
          data: { inviteCode: this.data.inviteCode },
          loading: true,
          error: '',
        })
        cart.clear()
        const user = await request({ url: '/api/auth/me' })
        wx.setStorageSync('user', user)
        getApp().globalData.user = user
        wx.showToast({ title: '已加入共同空间', icon: 'none' })
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 500)
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    }
  },
  async switchCouple(e) {
    if (this._switching) return
    const space = this.data.couples.find(
      (item) => String(item.id) === String(e.currentTarget.dataset.id),
    )
    if (!space) return
    if (space.isCurrent) return this.home()
    if (space.hasLeft) {
      const answer = await new Promise((resolve) =>
        wx.showModal({
          title: '重新加入这个空间？',
          content: '将恢复你在这个空间的成员身份，已有记录会保留。空间须有空位。',
          success: resolve,
        }),
      )
      if (!answer.confirm) return
    }
    this._switching = true
    try {
      await request({
        url: space.hasLeft ? `/api/couples/${space.id}/rejoin` : `/api/couples/switch/${space.id}`,
        method: 'POST',
        loading: true,
        error: '',
      })
      cart.clear()
      const user = await request({ url: '/api/auth/me' })
      wx.setStorageSync('user', user)
      getApp().globalData.user = user
      wx.showToast({ title: '已切换共同空间', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 450)
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' })
    } finally {
      this._switching = false
    }
  },
  copy() {
    wx.setClipboardData({ data: this.data.created.inviteCode })
  },
  home() {
    wx.switchTab({ url: '/pages/home/home' })
  },
})
