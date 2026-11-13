const { request } = require('../../services/api')
const thoughts = require('../../services/thoughts')
const { visibleUnread } = require('../../utils/thought-reading')
Page({
  data: {
    items: [],
    filter: 'all',
    loading: true,
    error: '',
    hasMore: false,
    composing: false,
    replyRoot: 0,
    selected: null,
    focused: false,
    me: {},
    partner: {},
    recent: '',
  },
  onLoad(options) {
    this._focusId = Number(options.focusId) || 0
    this._replyAfterLoad = options.reply === '1'
    this.setData({ focused: !!this._focusId })
  },
  onShow() {
    this._active = true
    this.loadPeople()
    this.load()
    this._timer = setInterval(() => this.load(false), 5000)
  },
  onHide() {
    this._active = false
    this._loadGeneration = (this._loadGeneration || 0) + 1
    this._loading = false
    clearInterval(this._timer)
    clearTimeout(this._readTimer)
  },
  onUnload() {
    this.onHide()
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },
  onPageScroll() {
    this.queueRead()
  },
  queueRead() {
    clearTimeout(this._readTimer)
    this._readTimer = setTimeout(() => this.markVisible(), 120)
  },
  async markVisible() {
    if (!this._active || this.data.composing || this._reading) return
    this._reading = true
    try {
      const messages = this.data.items.flatMap((i) => [i, ...(i.replies || [])])
      const selector = this.data.selected
        ? '.detail-sheet .thought-readable'
        : '.thought-page .thought-readable'
      const ids = await visibleUnread(
        this,
        selector,
        messages,
        this.data.selected ? '.detail-scroll' : null,
      )
      if (!this._active || !ids.length) return
      await thoughts.read(ids.slice(0, 200))
      const read = new Set(ids.slice(0, 200))
      const items = this.data.items.map((i) => ({
        ...i,
        replies: i.replies.map((r) =>
          read.has(r.id) ? { ...r, readAt: '已查看', status: '已查看' } : r,
        ),
        ...(read.has(i.id) ? { readAt: '已查看', status: '已查看' } : {}),
      }))
      if (this._active)
        this.setData({
          items,
          selected: this.data.selected
            ? items.find((i) => i.id === this.data.selected.id) || null
            : null,
        })
    } catch (_) {
    } finally {
      this._reading = false
    }
  },
  onReachBottom() {
    if (this.data.hasMore && !this._focusId) this.loadMore()
  },
  async loadPeople() {
    try {
      await getApp().loginPromise
      const user = wx.getStorageSync('user') || {}
      const space = await request({ url: '/api/couples/current' })
      const members = space.members || []
      const me = members.find((m) => m.id === user.id) || user
      const partner = members.find((m) => m.id !== user.id) || {}
      if (this._active)
        this.setData({
          me: { ...me, initial: (me.nickname || '我')[0] },
          partner: { ...partner, initial: (partner.nickname || '你')[0] },
        })
    } catch (_) {}
  },
  decorate(item, uid) {
    const mine = item.senderId === uid
    return {
      ...item,
      mine,
      day: item.createdAt.slice(0, 10),
      time: item.createdAt.slice(11, 16),
      senderName: mine ? '我' : item.senderName,
      status: mine ? (item.readAt ? '对方已看' : '对方未看') : item.readAt ? '已查看' : '未查看',
    }
  },
  async apply(result, mode) {
    const uid = result.userId
    let items = result.items || []
    if (mode === 'more') items = [...this.data.items, ...items]
    if (mode === 'refresh' && items.length) {
      const oldest = items[items.length - 1].id
      items = [...items, ...this.data.items.filter((i) => i.id < oldest)]
    }
    const unique = [...new Map(items.map((i) => [i.id, i])).values()]
    const view = unique.map((i) => ({
      ...this.decorate(i, uid),
      responded: (i.replies || []).some((r) => r.senderId !== i.senderId),
      replies: (i.replies || []).map((r) => this.decorate(r, uid)),
    }))
    view.forEach((i, idx) => {
      i.showDay = !idx || view[idx - 1].day !== i.day
    })
    if (this._replyAfterLoad && view.length) {
      this._replyAfterLoad = false
      this.setData({ composing: true, replyRoot: view[0].id })
    }
    const selected = this.data.selected
      ? view.find((i) => i.id === this.data.selected.id) || null
      : null
    if (this._active)
      this.setData(
        {
          items: view,
          hasMore:
            mode === 'refresh' && this.data.items.length > 20 ? this.data.hasMore : result.hasMore,
          selected,
          recent: view[0]?.createdAt || '',
          loading: false,
          error: '',
        },
        () => this.queueRead(),
      )
  },
  async load(reset = true) {
    if (this._loading) return
    this._loading = true
    const generation = this._loadGeneration || 0
    const filter = this.data.filter
    try {
      await getApp().loginPromise
      const result = await thoughts.list({ filter, focusId: this._focusId || 0 })
      if (this._active && generation === (this._loadGeneration || 0) && filter === this.data.filter)
        await this.apply(result, reset ? 'reset' : 'refresh')
    } catch (e) {
      if (this._active && generation === (this._loadGeneration || 0))
        this.setData({ loading: false, error: e.message })
    } finally {
      if (generation === (this._loadGeneration || 0)) this._loading = false
    }
  },
  async loadMore() {
    if (this._loading) return
    this._loading = true
    const generation = this._loadGeneration || 0
    try {
      const result = await thoughts.list({
        filter: this.data.filter,
        beforeId: this.data.items[this.data.items.length - 1]?.id || 0,
      })
      if (this._active && generation === (this._loadGeneration || 0)) {
        await this.apply(result, 'more')
        this.setData({ hasMore: result.hasMore })
      }
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    } finally {
      if (generation === (this._loadGeneration || 0)) this._loading = false
    }
  },
  filter(e) {
    if (this._loading) return
    this._focusId = 0
    this.setData({
      filter: e.currentTarget.dataset.filter,
      focused: false,
      items: [],
      loading: true,
    })
    this.load()
  },
  all() {
    if (this._loading) return
    this._focusId = 0
    this.setData({ focused: false })
    this.load()
  },
  compose() {
    this.setData({ composing: true, replyRoot: 0 })
  },
  reply(e) {
    this.setData({ composing: true, replyRoot: Number(e.currentTarget.dataset.id), selected: null })
  },
  closeCompose() {
    this.setData({ composing: false })
  },
  sent() {
    this.closeCompose()
    this.load()
  },
  detail(e) {
    this.setData(
      {
        selected: this.data.items.find((i) => i.id === Number(e.currentTarget.dataset.id)),
      },
      () => this.queueRead(),
    )
  },
  closeDetail() {
    this.setData({ selected: null })
  },
  noop() {},
  async remove(e) {
    const id = Number(e.currentTarget.dataset.id)
    const result = await new Promise((resolve) =>
      wx.showModal({
        title: '删除这条内容？',
        content: '双方都将无法查看。删除原留言时，该条留言的回复也会一起隐藏。',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      }),
    )
    if (!result.confirm) return
    try {
      await thoughts.remove(id)
      this.setData({ selected: null })
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' })
    }
  },
  notifications() {
    wx.navigateTo({ url: '/pages/notifications/notifications' })
  },
})
