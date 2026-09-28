App({
  onLaunch() {
    this.checkForUpdate()
    this.globalData.token = wx.getStorageSync('token') || ''
    this.globalData.user = wx.getStorageSync('user') || null
    this.loginPromise = this.login()
  },
  checkForUpdate() {
    if (typeof wx.getUpdateManager !== 'function') return
    const updateManager = wx.getUpdateManager()
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已经准备好，重新打开后即可使用。',
        confirmText: '重新打开',
        cancelText: '稍后更新',
        success: result => {
          if (result.confirm) updateManager.applyUpdate()
        }
      })
    })
    updateManager.onUpdateFailed(() => {
      wx.showModal({
        title: '更新暂未完成',
        content: '新版本下载失败，请检查网络后重新打开小程序。',
        showCancel: false
      })
    })
  },
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
