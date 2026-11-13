const { request } = require('../../services/api')
const subscribe = require('../../services/notifications')
function stabilizeAvatarUrls(page, items) {
  const now = Date.now()
  const cache = (page._avatarUrlCache ||= Object.create(null))
  return (items || []).map((item) => ({
    ...item,
    readers: (item.readers || []).map((reader) => {
      const id = String(reader.id)
      const url = reader.avatarUrl
      if (!url) {
        delete cache[id]
        return reader
      }
      const path = url.split('?')[0]
      const cached = cache[id]
      if (cached && cached.path === path && cached.expiresAt > now)
        return cached.url === url ? reader : { ...reader, avatarUrl: cached.url }
      cache[id] = { url, path, expiresAt: now + 4 * 60 * 1000 }
      return reader
    }),
  }))
}
Page({
  data: {
    items: [],
    unreadCount: 0,
    loading: true,
    error: '',
    configured: false,
    canSupplement: false,
    authorizing: false,
    testReady: false,
    testConfigured: false,
    testingEvent: '',
    templateHint: '',
    reminderGroups: [],
    testEvents: [],
    savingPreference: false,
    creditHint: '',
  },
  onShow() {
    this._visible = true
    return this.load()
  },
  onHide() {
    this._visible = false
    this.stopSync()
  },
  onUnload() {
    this._visible = false
    this.stopSync()
  },
  stopSync() {
    clearInterval(this._syncTimer)
    this._syncTimer = null
    this._syncGeneration = (this._syncGeneration || 0) + 1
  },
  startSync() {
    if (!this._visible || this._syncTimer) return
    this._syncTimer = setInterval(() => this.syncMessages(), 5000)
  },
  async syncMessages() {
    if (!this._visible || this.data.loading || this._syncing) return
    const generation = this._syncGeneration
    this._syncing = true
    try {
      const notifications = await request({ url: '/api/notifications' })
      if (this._visible && generation === this._syncGeneration)
        this.setData({
          items: stabilizeAvatarUrls(this, notifications.items),
          unreadCount: notifications.unreadCount || 0,
          error: '',
        })
    } catch (_) {
      /* 保留现有消息，下一轮自动重试。 */
    } finally {
      this._syncing = false
    }
  },
  async load() {
    this.stopSync()
    const generation = this._syncGeneration
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      const [notifications, config] = await Promise.all([
        request({ url: '/api/notifications' }),
        subscribe.loadConfig(true),
      ])
      if (!this._visible || generation !== this._syncGeneration) return
      this._templateIds = [
        config.orderTemplateId,
        config.servedTemplateId,
        config.thoughtTemplateId,
      ].filter((id, index, array) => id && array.indexOf(id) === index)
      const configured = this._templateIds.length > 0
      const credits = notifications.subscriptionCredits || {}
      subscribe.updateCredits(credits)
      const max = config.subscriptionCreditMax || 10
      const rows = [
        { event: 'created', label: '点菜提醒', templateId: config.orderTemplateId },
        { event: 'served', label: '做饭完成', templateId: config.servedTemplateId },
        { event: 'thought', label: '想念提醒', templateId: config.thoughtTemplateId },
      ].map((r) => ({
        ...r,
        enabled: config.preferences?.[r.event] !== false,
        count: credits[r.event] || 0,
        max,
      }))
      const canSupplement = rows.some((r) => r.templateId && r.enabled && r.count < max)
      const testEvents = rows
        .filter((row) => row.templateId)
        .map((row) => ({
          event: row.event,
          label:
            row.event === 'created'
              ? '测试点菜提醒'
              : row.event === 'served'
                ? '测试做饭完成'
                : '测试想念提醒',
        }))
      this.setData({
        items: stabilizeAvatarUrls(this, notifications.items),
        unreadCount: notifications.unreadCount || 0,
        configured,
        reminderGroups: [
          { title: '小饭桌', rows: rows.slice(0, 2) },
          { title: '想你了', rows: rows.slice(2) },
        ],
        testEvents,
        canSupplement,
        testReady: configured,
        testConfigured: configured,
        templateHint: configured
          ? canSupplement
            ? `为所有已开启的提醒各补充一次，每类最多${max}次`
            : '当前没有需要补充的提醒，可检查接收开关或等待次数消耗'
          : '微信订阅消息暂未配置，站内消息照常可用',
        creditHint: configured
          ? `预计可用：点菜提醒 ${credits.created || 0} 次 · 做饭完成 ${credits.served || 0} 次 · 想念 ${credits.thought || 0} 次`
          : '',
        loading: false,
      })
    } catch (error) {
      if (this._visible && generation === this._syncGeneration)
        this.setData({ loading: false, error: error.message || '消息暂时没打开' })
    } finally {
      if (generation === this._syncGeneration) this.startSync()
    }
  },
  async preference(event) {
    if (this.data.savingPreference) return
    this.setData({ savingPreference: true })
    try {
      await request({
        url: '/api/notifications/preferences',
        method: 'PUT',
        data: { event: event.currentTarget.dataset.event, enabled: event.detail.value },
      })
      await subscribe.loadConfig(true)
      await this.load()
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
      this.load()
    } finally {
      this.setData({ savingPreference: false })
    }
  },
  async subscribe(event) {
    if (this.data.authorizing || this.data.testingEvent || this.data.savingPreference) return
    if (!this._templateIds || !this._templateIds.length)
      return wx.showToast({ title: '微信提醒暂未配置', icon: 'none' })
    if (!this.data.canSupplement)
      return wx.showToast({ title: '当前没有需要补充的提醒', icon: 'none' })
    const selectedEvent = event?.currentTarget?.dataset?.event
    const events = selectedEvent ? [selectedEvent] : ['created', 'served', 'thought']
    this.setData({ authorizing: true })
    try {
      const result = await subscribe.authorizeAtAction(events)
      const names = { created: '点菜', served: '做饭完成', thought: '想念' }
      const added = Object.keys(result.addedByEvent || {}).map((key) => names[key]).filter(Boolean)
      const unfinished = result.unfinishedEvents || []
      if (unfinished.length) {
        const statusLabels = {
          accept: '已同意', acceptWithAudio: '已同意', reject: '未同意',
          ban: '模板已停用', filter: '同名模板被过滤', missing: '微信未返回结果',
          failed: '授权调用失败', gesture_required: '微信要求重新点击授权',
        }
        const details = Object.entries(result.statusByEvent || {}).map(([key, status]) =>
          `${names[key]}：${result.addedByEvent?.[key] ? '已补充' : statusLabels[status] || '未完成'}`,
        ).join('；')
        await new Promise((resolve) => wx.showModal({
          title: result.accepted ? '已完成部分补充' : '提醒尚未补充',
          content: `${details || '未获得授权'}。${result.isDevtools
            ? '当前是开发者工具环境，请用手机微信扫码预览验证批量授权。'
            : '未同意的类型可在微信设置中检查；其余可用单独补充重试。'}`,
          showCancel: false,
          confirmColor: '#42664f',
          complete: resolve,
        }))
      } else wx.showToast({
        title: result.configFailed
          ? '提醒配置未加载，请重试'
          : result.recordFailed
          ? '授权登记失败，请重试'
          : result.capped
            ? '该类提醒已满额或未开启'
            : result.accepted
              ? added.length ? `已补充：${added.join('、')}` : `已增加 ${result.accepted} 类提醒机会`
              : '未获得授权，可在微信设置检查',
        icon: 'none',
      })
      await this.load()
    } finally {
      this.setData({ authorizing: false })
    }
  },
  async sendTest(event) {
    const eventType = event.currentTarget.dataset.event
    if (!this.data.testReady || this.data.testingEvent || this.data.authorizing || this.data.savingPreference) return
    this.setData({ testingEvent: eventType })
    try {
      const result = await subscribe.testSend(eventType)
      if (result.sent) wx.showToast({ title: '已请求发送', icon: 'none', duration: 2200 })
      else
        wx.showModal({
          title: '测试消息未发送',
          content: result.reason || '请稍后再试',
          showCancel: false,
        })
      this.load()
    } catch (error) {
      wx.showToast({ title: error.message || '测试发送失败', icon: 'none' })
    } finally {
      this.setData({ testingEvent: '' })
    }
  },
  async markRead() {
    try {
      await request({ url: '/api/notifications/read', method: 'PUT' })
      await this.load()
    } catch (error) {
      wx.showToast({ title: error.message || '稍后再试', icon: 'none' })
    }
  },
  openOrder(event) {
    if (!event.currentTarget.dataset.id) return
    wx.navigateTo({ url: `/pages/order-detail/order-detail?id=${event.currentTarget.dataset.id}` })
  },
})
