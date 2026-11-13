Component({
  properties: { title: { type: String, value: '' }, background: { type: String, value: '#fff' } },
  data: { statusBarHeight: 20 },
  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      this.setData({ statusBarHeight: info.statusBarHeight || 20 })
    },
  },
  methods: {
    back() {
      wx.navigateBack({
        delta: 1,
        fail() {
          wx.switchTab({ url: '/pages/settings/settings' })
        },
      })
    },
  },
})
