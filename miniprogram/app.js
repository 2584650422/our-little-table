App({
  onLaunch() {
    this.globalData.token = wx.getStorageSync('token') || ''
    this.globalData.user = wx.getStorageSync('user') || null
    this.loginPromise = this.login()
  },
  login() {
    const auth = require('./services/auth')
    return auth.ensureLogin().then(data => {
      this.globalData.token = data.token
      this.globalData.user = data.user
      return data
    }).catch(error => { this.globalData.loginError = error.message; console.warn('login pending:', error.message); return null })
  },
  globalData: {
    token: '', user: null, cart: [], loginError: ''
  }
})
