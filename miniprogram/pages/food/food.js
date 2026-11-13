const dishesApi = require('../../services/dishes')
const cart = require('../../utils/cart')
const layout = require('../../utils/layout')

Page({
  data: {
    topInset: layout.topInset(),
    greeting: '',
    heading: '今天吃什么？',
    subtitle: '从小菜单里，挑一道喜欢的菜。',
    recommendations: [],
    recommendationIndex: 0,
    loading: true,
    error: '',
    needsCouple: false,
  },
  onShow() {
    this.bootstrap()
  },
  async bootstrap() {
    const now = new Date(),
      h = now.getHours()
    this.setData({
      greeting: h < 11 ? '早上好' : h < 17 ? '下午好' : '晚上好',
      loading: true,
      error: '',
    })
    try {
      await getApp().loginPromise
      const user = wx.getStorageSync('user')
      if (!user?.coupleId) {
        this.setData({ needsCouple: true, loading: false })
        return
      }
      const recommendations = await dishesApi.recommend(3)
      this.setData({
        recommendations,
        recommendationIndex: 0,
        needsCouple: false,
        loading: false,
      })
    } catch (e) {
      this.setData({ error: e.message || '网络好像开小差了', loading: false })
    }
  },
  async shuffle() {
    if (this.data.recommendationIndex < this.data.recommendations.length - 1) {
      this.setData({ recommendationIndex: this.data.recommendationIndex + 1 })
      return
    }
    try {
      this.setData({ recommendations: await dishesApi.recommend(3), recommendationIndex: 0 })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    }
  },
  recommendChanged(e) {
    this.setData({ recommendationIndex: e.detail.current })
  },
  detail(e) {
    wx.navigateTo({ url: `/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}` })
  },
  add(e) {
    const dish = this.data.recommendations.find(
      (item) => String(item.id) === String(e.currentTarget.dataset.id),
    )
    if (!dish) return
    cart.add(dish)
    wx.showToast({ title: '已经放进小菜单啦', icon: 'none' })
  },
  back() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/menu/menu' })
  },
  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  },
  goCouple() {
    wx.navigateTo({ url: '/pages/couple/couple' })
  },
})
