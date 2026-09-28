const updates = require('./services/updates')

App({
  onLaunch() {
    updates.init()
    this.globalData.token = wx.getStorageSync('token') || ''
    this.globalData.user = wx.getStorageSync('user') || null
    this.loginPromise = this.login()
  },
  onShow() { updates.onShow() },
  onHide() { updates.onHide() },
  login() {
    const auth = require('./services/auth')
    return auth.ensureLogin().then(data => {
      this.globalData.token = data.token
      this.globalData.user = data.user
      require('./services/notifications').warmConfig()
      return data
    }).catch(error => { this.globalData.loginError = error.message; console.warn('login pending:', error.message); return null })
  },
  globalData: {
    token: '', user: null, cart: [], loginError: ''
  }
})
