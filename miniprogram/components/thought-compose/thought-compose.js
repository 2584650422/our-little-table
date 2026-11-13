const thoughts = require('../../services/thoughts')
Component({
  properties: { open: Boolean, rootId: Number, replying: Boolean },
  data: { content: '', sending: false, presets: ['想你了', '想抱抱你', '等你回家'] },
  observers: {
    open(value) {
      if (value) {
        this._requestId = ''
        this.setData({ content: '' })
      }
    },
  },
  methods: {
    noop() {},
    close() {
      if (!this.data.sending) this.triggerEvent('close')
    },
    input(e) {
      this._requestId = ''
      this.setData({ content: e.detail.value })
    },
    preset(e) {
      this._requestId = ''
      this.setData({ content: e.currentTarget.dataset.text })
    },
    async send() {
      if (this.data.sending) return
      this._requestId =
        this._requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      this.setData({ sending: true })
      try {
        const result = await thoughts.send({
          requestId: this._requestId,
          content: this.data.content.trim(),
          rootId: this.data.rootId || null,
        })
        wx.showToast({ title: '已发送', icon: 'success' })
        this.triggerEvent('sent', result)
      } catch (e) {
        wx.showToast({ title: e.message || '发送失败，请重试', icon: 'none' })
      } finally {
        this.setData({ sending: false })
      }
    },
  },
})
