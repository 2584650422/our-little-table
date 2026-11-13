const api = require('../../services/dishes')
Page({
  data: { dishes: [], keyword: '', loading: true, error: '', busy: false },
  onShow() {
    this.load()
  },
  sort(list) {
    return list
      .slice()
      .sort(
        (a, b) =>
          Number(b.orderedCount || 0) - Number(a.orderedCount || 0) ||
          String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'),
      )
  },
  apply() {
    const keyword = this.data.keyword.trim().toLowerCase()
    this.setData({
      dishes: this.sort(this._all || []).filter(
        (item) =>
          !keyword ||
          [item.name, item.description, item.categoryName, ...(item.tags || [])]
            .join(' ')
            .toLowerCase()
            .includes(keyword),
      ),
    })
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      this._all = await api.list({ includeDisabled: true })
      this.apply()
      this.setData({ loading: false })
    } catch (e) {
      this.setData({ loading: false, error: e.message || '菜单暂时加载不了' })
    }
  },
  input(e) {
    this.setData({ keyword: e.detail.value }, () => this.apply())
  },
  clearSearch() {
    this.setData({ keyword: '' }, () => this.apply())
  },
  add() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  },
  categories() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' })
  },
  edit(e) {
    wx.navigateTo({ url: `/pages/dish-edit/dish-edit?id=${e.currentTarget.dataset.id}` })
  },
  async disable(e) {
    await this.changeDish(
      e,
      'disable',
      '把这道菜收起来？',
      '下架后可重新上架，也可以从管理列表删除；历史记录会保留。',
    )
  },
  async restore(e) {
    await this.changeDish(e, 'restore', '把这道菜放回菜单？', '重新上架后，就可以继续点这道菜了。')
  },
  async remove(e) {
    await this.changeDish(
      e,
      'remove',
      '从菜单管理中删除？',
      '删除后不再显示在菜单和管理列表中，历史点菜记录和照片仍保留。',
    )
  },
  async changeDish(e, action, title, content) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const r = await new Promise((resolve) =>
        wx.showModal({
          title,
          content,
          confirmText: action === 'remove' ? '删除' : '确定',
          success: resolve,
        }),
      )
      if (!r.confirm) return
      await api[action](e.currentTarget.dataset.id)
      await this.load()
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },
})
