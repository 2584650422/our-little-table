const { request } = require('../../services/api')
const cart = require('../../utils/cart')
const upload = require('../../services/upload')

function discardStagedAvatar(key) {
  if (!key || key === (wx.getStorageSync('user') || {}).avatarKey) return Promise.resolve()
  return request({ url: '/api/uploads/discard', method: 'POST', data: { key } }).catch((error) =>
    console.warn('[avatar cleanup] failed', error.message),
  )
}
Page({
  data: {
    couple: null,
    name: '',
    nickname: '',
    avatarUrl: '',
    avatarImageKey: '',
    loading: true,
    saving: false,
    error: '',
    showDanger: false,
    canDelete: false,
    uploadingAvatar: false,
    uploadStage: '',
  },
  onLoad(options = {}) {
    this._focus = options.focus
    this.load()
  },
  onUnload() {
    this._disposed = true
    if (!this._saving) discardStagedAvatar(this.data.avatarImageKey)
  },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      const [couple, user] = await Promise.all([
        request({ url: '/api/couples/current' }),
        request({ url: '/api/auth/me' }),
      ])
      if (this._disposed) return
      this._savedName = couple.name
      this._savedUser = user
      wx.setStorageSync('user', user)
      getApp().globalData.user = user
      this.setData({
        couple,
        canDelete:
          String(couple.createdBy) === String(user.id) &&
          (couple.members || []).length === 1 &&
          String(couple.members[0].id) === String(user.id),
        name: couple.name,
        nickname: user.nickname || '',
        avatarUrl: user.avatarUrl || '',
        avatarImageKey: user.avatarKey || '',
        loading: false,
      })
      if (this._focus === 'members') {
        this._focus = ''
        this.viewMembers()
      }
    } catch (error) {
      if (!this._disposed)
        this.setData({ loading: false, error: error.message || '暂时没能打开设置' })
    }
  },
  input(e) {
    if (!this._saving) this.setData({ [e.currentTarget.dataset.key]: e.detail.value })
  },
  viewMembers() {
    if (!this._saving) wx.navigateTo({ url: '/pages/couple-members/couple-members' })
  },
  toggleDanger() {
    this.setData({ showDanger: !this.data.showDanger })
  },
  async chooseAvatar() {
    if (this._choosingAvatar || this._saving) return
    this._choosingAvatar = true
    try {
      const result = await new Promise((resolve, reject) =>
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject,
        }),
      )
      this.setData({ uploadingAvatar: true })
      const image = await upload.uploadImage(result.tempFiles[0].tempFilePath, 'avatar', (stage) =>
        this.setData({ uploadStage: stage }),
      )
      if (this._disposed) {
        await discardStagedAvatar(image.imageKey)
        return
      }
      const previousKey = this.data.avatarImageKey
      this.setData({ avatarUrl: image.imageUrl, avatarImageKey: image.imageKey })
      if (previousKey !== image.imageKey) await discardStagedAvatar(previousKey)
      wx.showToast({ title: '头像选好啦，记得保存', icon: 'none' })
    } catch (e) {
      if (!String(e.errMsg || '').includes('cancel'))
        wx.showToast({ title: e.message || '头像选择失败', icon: 'none' })
    } finally {
      this._choosingAvatar = false
      if (!this._disposed) this.setData({ uploadingAvatar: false, uploadStage: '' })
    }
  },
  removeAvatar() {
    if (this._choosingAvatar || this._saving) return
    const previousKey = this.data.avatarImageKey
    this.setData({ avatarUrl: '', avatarImageKey: '' })
    discardStagedAvatar(previousKey)
  },
  async save() {
    if (this._choosingAvatar) {
      wx.showToast({ title: '请等待头像上传完成', icon: 'none' })
      return
    }
    if (this._saving) return
    const name = this.data.name.trim(),
      nickname = this.data.nickname.trim(),
      old = this._savedUser || {}
    if (!name || !nickname) {
      this.setData({ error: '请填写空间名称和我的昵称' })
      return
    }
    const nameChanged = name !== this._savedName
    const profileChanged =
      nickname !== old.nickname ||
      this.data.avatarImageKey !== (old.avatarKey || '') ||
      (!this.data.avatarImageKey && this.data.avatarUrl !== (old.avatarUrl || ''))
    if (!nameChanged && !profileChanged) {
      wx.showToast({ title: '没有需要保存的修改', icon: 'none' })
      return
    }
    this._saving = true
    this.setData({ saving: true, error: '' })
    let nameSaved = false
    try {
      if (nameChanged) {
        await request({ url: '/api/couples/current/name', method: 'PUT', data: { name } })
        this._savedName = name
        nameSaved = true
        if (!this._disposed) this.setData({ name, couple: { ...this.data.couple, name } })
      }
      if (profileChanged) {
        const user = await request({
          url: '/api/auth/me',
          method: 'PUT',
          data: {
            nickname,
            avatarImageKey: this.data.avatarImageKey || null,
            avatarUrl: this.data.avatarUrl || null,
          },
        })
        wx.setStorageSync('user', user)
        getApp().globalData.user = user
        this._savedUser = user
        if (!this._disposed)
          this.setData({
            nickname: user.nickname,
            avatarImageKey: user.avatarKey || '',
            avatarUrl: user.avatarUrl || '',
          })
      }
      wx.showToast({ title: '设置已保存', icon: 'none' })
    } catch (error) {
      if (!this._disposed)
        this.setData({
          error:
            (nameSaved ? '空间名称已保存，个人资料未保存。' : '') +
            (error.message || '保存失败，请重试'),
        })
    } finally {
      this._saving = false
      if (!this._disposed) this.setData({ saving: false })
      else discardStagedAvatar(this.data.avatarImageKey)
    }
  },
  async resetStagedAvatar() {
    await discardStagedAvatar(this.data.avatarImageKey)
    const user = this._savedUser || {}
    this.setData({ avatarImageKey: user.avatarKey || '', avatarUrl: user.avatarUrl || '' })
  },
  async switchSpace() {
    if (this._saving || this._choosingAvatar) return
    await this.resetStagedAvatar()
    wx.navigateTo({ url: '/pages/couple/couple' })
  },
  async leave() {
    if (this._saving || this._choosingAvatar) return
    const result = await new Promise((resolve) =>
      wx.showModal({
        title: '离开当前共同空间？',
        content: '离开后不再共享这个空间；菜单、用餐记录、日历和足迹仍会保留。',
        confirmText: '确认离开',
        confirmColor: '#A65F4C',
        success: resolve,
      }),
    )
    if (!result.confirm) return
    try {
      await this.resetStagedAvatar()
      await request({ url: '/api/couples/leave', method: 'POST', loading: true })
      const user = await request({ url: '/api/auth/me' })
      wx.setStorageSync('user', user)
      getApp().globalData.user = user
      cart.clear()
      wx.showToast({ title: '已离开共同空间', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/settings/settings' }), 500)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },
  async deleteSpace() {
    if (!this.data.canDelete) {
      wx.showToast({ title: '仅创建者且空间中没有其他成员时可删除', icon: 'none' })
      return
    }
    if (this._saving || this._choosingAvatar) return
    const result = await new Promise((resolve) =>
      wx.showModal({
        title: '永久删除共同空间？',
        content:
          '空间里的菜单、用餐记录、日历记录和足迹照片都将删除，无法恢复。仅创建者且没有其他成员时可操作。',
        confirmText: '永久删除',
        confirmColor: '#A65F4C',
        success: resolve,
      }),
    )
    if (!result.confirm) return
    try {
      await request({ url: '/api/couples/current', method: 'DELETE', loading: true })
      const user = await request({ url: '/api/auth/me' })
      wx.setStorageSync('user', user)
      getApp().globalData.user = user
      cart.clear()
      wx.showToast({ title: '共同空间已删除', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/settings/settings' }), 500)
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },
})
