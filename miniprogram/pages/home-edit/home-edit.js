const api = require('../../services/life')
const { request } = require('../../services/api')
const { date } = require('../../utils/life')

Page({
  data: {
    name: '',
    tagline: '把日子慢慢过。',
    anniversary: '',
    today: date(),
    loading: true,
    saving: false,
    error: '',
  },
  onLoad() {
    this.load()
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      const home = await request({ url: '/api/couples/current' })
      this.setData({
        name: home.name || '',
        tagline: home.lifeTagline || '把日子慢慢过。',
        anniversary: home.anniversary || '',
        loading: false,
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message })
    }
  },
  input(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value })
  },
  chooseDate(event) {
    this.setData({ anniversary: event.detail.value })
  },
  clearDate() {
    this.setData({ anniversary: '' })
  },
  async save() {
    if (this.data.saving) return
    const tagline = this.data.tagline.trim()
    if (!tagline) {
      this.setData({ error: '请写下首页的一句话' })
      return
    }
    this.setData({ saving: true, error: '' })
    try {
      await api.saveHome({ tagline, anniversary: this.data.anniversary || null })
      wx.showToast({ title: '首页已更新', icon: 'none' })
      wx.navigateBack()
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ saving: false })
    }
  },
})
