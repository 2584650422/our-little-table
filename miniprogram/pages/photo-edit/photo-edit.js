const api = require('../../services/life')
const life = require('../../utils/life')
const upload = require('../../services/upload')
const { request } = require('../../services/api')

function callApi(name, options = {}) {
  return new Promise((resolve, reject) => wx[name]({ ...options, success: resolve, fail: reject }))
}

async function openLocationSettings() {
  const result = await callApi('showModal', {
    title: '需要位置权限',
    content: '微信需要位置权限才能打开地图选点。请在设置中允许后重试。',
    confirmText: '去设置',
    cancelText: '暂不设置',
  })
  if (!result.confirm) return false
  const setting = await callApi('openSetting')
  return setting.authSetting?.['scope.userLocation'] === true
}

Page({
  data: {
    photos: [],
    editingId: null,
    loading: false,
    hasChanges: false,
    city: '',
    caption: '',
    takenOn: life.date(),
    today: life.date(),
    latitude: null,
    longitude: null,
    locationPermissionText: '正在检查位置权限…',
    saving: false,
    stage: '',
    error: '',
  },
  async onLoad(options = {}) {
    if (!options.id) return
    this.setData({ editingId: options.id, loading: true })
    wx.setNavigationBarTitle({ title: '编辑照片信息' })
    const channel = this.getOpenerEventChannel?.()
    channel?.on('editPhoto', (photo) => this.hydratePhoto(photo))
    try {
      await getApp().loginPromise
      if (!this._photoLoaded) this.hydratePhoto(await api.photo(options.id))
    } catch (e) {
      if (!this._photoLoaded) this.setData({ error: e.message || '照片加载失败，请返回后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },
  hydratePhoto(photo) {
    if (!photo) return
    this._photoLoaded = true
    const values = {
      city: photo.city || '',
      caption: photo.caption || '',
      takenOn: photo.takenOn || life.date(),
      latitude: photo.latitude ?? null,
      longitude: photo.longitude ?? null,
    }
    this._original = values
    this.setData({
      ...values,
      photos: [{ path: photo.previewUrl, width: photo.width, height: photo.height }],
      hasChanges: false,
      error: '',
    })
  },
  refreshChanges(next = {}) {
    if (!this.data.editingId || !this._original) return
    const current = { ...this.data, ...next }
    const hasChanges = ['city', 'caption', 'takenOn', 'latitude', 'longitude'].some(
      (key) => String(current[key] ?? '') !== String(this._original[key] ?? ''),
    )
    this.setData({ hasChanges })
  },
  onShow() {
    this.refreshLocationPermission()
  },
  async refreshLocationPermission() {
    try {
      const setting = await callApi('getSetting')
      const permission = setting.authSetting?.['scope.userLocation']
      this.setData({
        locationPermissionText:
          permission === true
            ? '位置权限已开启 · 管理'
            : permission === false
              ? '位置权限未开启 · 去设置'
              : '尚未请求位置授权 · 选择地点时授权',
      })
    } catch (_) {
      this.setData({ locationPermissionText: '查看位置权限设置' })
    }
  },
  field(e) {
    if (this.data.saving) return
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    this.setData({ [field]: value })
    this.refreshChanges({ [field]: value })
  },
  async choose() {
    if (
      this.data.editingId ||
      this.data.loading ||
      this.data.saving ||
      this.data.photos.length >= 9
    )
      return
    try {
      const result = await callApi('chooseMedia', {
        count: 9 - this.data.photos.length,
        mediaType: ['image'],
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      })
      const additions = []
      for (const file of result.tempFiles) {
        if (file.size > 10 * 1024 * 1024) throw new Error('单张照片不能超过 10MB，请重新选择')
        const info = await callApi('getImageInfo', { src: file.tempFilePath })
        if (!['jpg', 'jpeg', 'png', 'webp'].includes(String(info.type).toLowerCase()))
          throw new Error('请选择 JPG、PNG 或 WEBP；HEIC 请先导出为 JPG')
        additions.push({ path: file.tempFilePath, width: info.width, height: info.height })
      }
      this.setData({ photos: [...this.data.photos, ...additions], error: '' })
    } catch (e) {
      if (!String(e.errMsg).includes('cancel')) this.setData({ error: e.message || '无法读取照片' })
    }
  },
  removePhoto(e) {
    if (this.data.saving) return
    this.setData({
      photos: this.data.photos.filter(
        (_, index) => index !== Number(e.currentTarget.dataset.index),
      ),
    })
  },
  previewPhoto(e) {
    const urls = this.data.photos.map((photo) => photo.path)
    wx.previewImage({ current: urls[Number(e.currentTarget.dataset.index)], urls })
  },
  async chooseLocation() {
    if (this.data.saving) return
    try {
      const place = await callApi('chooseLocation')
      this.setData({
        city: place.name || place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        error: '',
      })
      this.refreshChanges({
        city: place.name || place.address,
        latitude: place.latitude,
        longitude: place.longitude,
      })
      this.refreshLocationPermission()
    } catch (e) {
      this.showLocationError(e, '地点选择失败')
    }
  },
  showLocationError(e, fallback) {
    const detail = String(e.errMsg || e.message || '')
    if (detail.includes('cancel')) return
    let hint = fallback
    if (/privacy|privac/i.test(detail))
      hint = '请在微信公众平台补充位置相关隐私保护指引，并确认预览版本使用了最新配置'
    else if (/auth deny|auth denied/i.test(detail))
      hint = '位置授权未完成，请检查小程序授权及手机系统中的微信定位权限'
    else if (/permission|no permission|api scope/i.test(detail))
      hint = '请确认当前小程序 AppID 的地图选点接口已审核通过'
    this.setData({ error: `${hint}${detail ? `（${detail}）` : '，请稍后重试'}` })
  },
  async locationAccess() {
    try {
      const setting = await callApi('getSetting')
      if (setting.authSetting?.['scope.userLocation'] === true) {
        await callApi('openSetting')
      } else if (setting.authSetting?.['scope.userLocation'] === false) {
        await openLocationSettings()
      } else {
        await this.chooseLocation()
      }
      await this.refreshLocationPermission()
    } catch (e) {
      this.setData({ error: String(e.errMsg || e.message || '无法打开位置权限设置') })
    }
  },
  async save() {
    if (this.data.loading || this.data.saving) return
    if (this.data.editingId && !this.data.hasChanges) return
    if (!this.data.photos.length) {
      this.setData({ error: '请先选择照片' })
      return
    }
    if (
      !this.data.city ||
      (!this.data.editingId && (this.data.latitude === null || this.data.longitude === null))
    ) {
      this.setData({ error: '请先在地图中搜索并选择拍摄地点' })
      return
    }
    this.setData({ saving: true, error: '' })
    if (this.data.editingId) {
      try {
        await api.updatePhoto(this.data.editingId, {
          city: this.data.city,
          caption: this.data.caption,
          takenOn: this.data.takenOn,
          latitude: this.data.latitude,
          longitude: this.data.longitude,
        })
        wx.showToast({ title: '照片信息已更新', icon: 'none' })
        wx.navigateBack()
      } catch (e) {
        this.setData({ error: e.message || '更新失败，请重试' })
      } finally {
        this.setData({ saving: false })
      }
      return
    }
    const total = this.data.photos.length
    let saved = 0
    try {
      while (this.data.photos.length) {
        const photo = this.data.photos[0]
        let images
        try {
          images = await upload.uploadTravelPhoto(photo.path, (stage) =>
            this.setData({ stage: `${saved + 1}/${total} · ${stage}` }),
          )
          await api.addPhoto({
            ...images,
            city: this.data.city,
            caption: this.data.caption,
            takenOn: this.data.takenOn,
            latitude: this.data.latitude,
            longitude: this.data.longitude,
          })
        } catch (e) {
          if (images)
            await Promise.all(
              [images.originalKey, images.previewKey].map((key) =>
                request({ url: '/api/uploads/discard', method: 'POST', data: { key } }).catch(
                  () => {},
                ),
              ),
            )
          throw e
        }
        saved++
        this.setData({ photos: this.data.photos.slice(1) })
      }
      wx.navigateBack()
    } catch (e) {
      this.setData({
        error: `已保存 ${saved}/${total} 张，剩余照片可重试。${e.message || '保存失败，请重试'}`,
      })
    } finally {
      this.setData({ saving: false, stage: '' })
    }
  },
})
