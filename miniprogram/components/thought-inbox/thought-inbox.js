const thoughts = require('../../services/thoughts')
Component({
  data: { item: null, count: 0, busy: false },
  pageLifetimes: {
    show() {
      this.start()
    },
    hide() {
      this.stop()
    },
  },
  lifetimes: {
    detached() {
      this.stop()
    },
  },
  methods: {
    noop() {},
    start() {
      this.stop()
      this._active = true
      this.check()
      this._timer = setInterval(() => this.check(), 15000)
    },
    stop() {
      this._active = false
      this._epoch = (this._epoch || 0) + 1
      clearInterval(this._timer)
    },
    async check() {
      if (this._checking || this.data.item) return
      this._checking = true
      const epoch = this._epoch
      try {
        await getApp().loginPromise
        if (!this._active || !wx.getStorageSync('user')?.coupleId) return
        const result = await thoughts.unread()
        if (!this._active || epoch !== this._epoch) return
        this.triggerEvent('unread', { count: (result.items || []).length })
        const items = thoughts.unseen(result.items || [])
        if (items.length) {
          thoughts.dismiss(items)
          this.setData({ item: items[0], count: items.length })
        }
      } catch (_) {
      } finally {
        this._checking = false
      }
    },
    close() {
      if (!this.data.busy) this.setData({ item: null })
    },
    async confirm() {
      if (this.data.busy) return
      this.setData({ busy: true })
      try {
        await thoughts.read([this.data.item.id])
        this.setData({ item: null })
      } catch (e) {
        wx.showToast({ title: e.message, icon: 'none' })
      } finally {
        this.setData({ busy: false })
      }
    },
    async open() {
      const item = this.data.item
      try {
        await thoughts.read([item.id])
      } catch (_) {}
      this.setData({ item: null })
      wx.navigateTo({
        url:
          this.data.count > 1
            ? '/pages/thoughts/thoughts'
            : '/pages/thoughts/thoughts?focusId=' + item.id + '&reply=1',
      })
    },
  },
})
