const api = require('../../services/life')
const life = require('../../utils/life')
const upload = require('../../services/upload')
const { request } = require('../../services/api')
const { readMetadata } = require('../../utils/photo-metadata')

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
    activePhotoIndex: 0,
    provinceName: '',
    cityName: '',
    editingId: null,
    loading: false,
    hasChanges: false,
    city: '',
    caption: '',
    takenOn: '',
    today: life.date(),
    latitude: null,
    longitude: null,
    locationPermissionText: '正在检查位置权限…',
    saving: false,
    stage: '',
    error: '',
    pickerError: null,
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
      provinceName: photo.provinceName || '',
      cityName: photo.cityName || '',
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
  selectPhoto(e) {
    if (this.data.saving || this.data.loading) return
    this.showPhoto(Number(e.currentTarget.dataset.index))
  },
  showPhoto(index) {
    const photo = this.data.photos[index]
    if (!photo || this.data.editingId) return
    this.setData({
      activePhotoIndex: index,
      city: photo.city || '',
      takenOn: photo.takenOn || '',
      caption: photo.caption || '',
      latitude: photo.latitude ?? null,
      longitude: photo.longitude ?? null,
      provinceName: photo.provinceName || '',
      cityName: photo.cityName || '',
    })
  },
  updateActive(values) {
    if (!this.data.editingId) {
      const photos = this.data.photos.map((photo, index) =>
        index === this.data.activePhotoIndex ? { ...photo, ...values } : photo,
      )
      this.setData({ photos })
    }
    this.setData(values)
    this.refreshChanges(values)
  },
  field(e) {
    if (this.data.saving || this.data.loading) return
    this.updateActive({ [e.currentTarget.dataset.field]: e.detail.value })
  },
  async choose() {
    if (
      this.data.editingId ||
      this.data.loading ||
      this.data.saving ||
      this.data.photos.length >= 9
    )
      return
    const count = 9 - this.data.photos.length
    this.setData({ loading: true, error: '', pickerError: null })
    let selecting = true
    try {
      const result = await callApi('chooseMedia', {
        count,
        mediaType: ['image'],
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      })
      selecting = false
      const additions = []
      for (const file of (result.tempFiles || []).slice(0, count)) {
        const path = file.tempFilePath
        if (!path) throw new Error('微信没有返回照片文件，请重新选择')
        if (file.size > 10 * 1024 * 1024) throw new Error('单张照片不能超过 10MB，请重新选择')
        const info = await callApi('getImageInfo', { src: path }).catch(() => {
          throw new Error('无法读取图片，请选择 JPG、PNG 或 WEBP 文件')
        })
        if (!['jpg', 'jpeg', 'png', 'webp'].includes(String(info.type).toLowerCase()))
          throw new Error('请选择 JPG、PNG 或 WEBP；HEIC 请先导出为 JPG')
        const metadata = await readMetadata(path)
        const { latitude, longitude } = metadata
        const hasGps = latitude != null && longitude != null
        const takenOn =
          metadata.takenOn &&
          metadata.takenOn <= this.data.today &&
          metadata.takenOn >= '1901-01-01'
            ? metadata.takenOn
            : ''
        let region = {}
        if (hasGps) {
          try {
            region = await api.location(latitude, longitude)
          } catch (_) {}
        }
        const size = metadata.bytes || file.size
        const fileSize = size > 0 ? ` · ${(size / 1048576).toFixed(2)} MiB` : ''
        const metadataHint = metadata.readFailed
          ? '无法读取所选文件，请重新选择'
          : `拍摄日期${takenOn ? '已读取' : '未读到'} · GPS${hasGps ? '已读取' : '未读到'}`
        const diagnostic = metadata.diagnostic || {}
        const metadataReport = {
          source: result.sourceType || 'album',
          api: 'chooseMedia',
          format: diagnostic.format || '无法从文件头识别',
          pickerFormat: info.type,
          pickerBytes: file.size ?? null,
          readBytes: metadata.bytes ?? null,
          fileRead: metadata.readFailed ? '失败' : '成功',
          exif:
            metadata.readFailed || !diagnostic.format ? '未知' : diagnostic.exif ? '有' : '未找到',
          rootDirectory: diagnostic.rootDirectory?.status ?? null,
          exifDirectory: diagnostic.exifDirectory?.status ?? null,
          gpsDirectory: diagnostic.gpsDirectory?.status ?? null,
          dateTag: diagnostic.dateTag ?? null,
          gpsCoordinateTags: diagnostic.gpsCoordinateTags ?? null,
          dateField: diagnostic.dateField ?? null,
          gpsFields: diagnostic.gpsFields ?? null,
          dateParsed: Boolean(metadata.takenOn),
          dateFilled: Boolean(takenOn),
          gpsParsed: hasGps,
        }
        additions.push({
          path,
          width: info.width,
          height: info.height,
          ...region,
          caption: '',
          latitude,
          longitude,
          takenOn,
          city: hasGps ? region.cityName || '照片拍摄位置' : '',
          metadataHint: metadataHint + fileSize,
          metadataReport,
        })
      }
      if (!additions.length) return
      const index = this.data.photos.length
      this.setData({ photos: [...this.data.photos, ...additions], error: '' })
      this.showPhoto(index)
    } catch (e) {
      if (selecting) {
        const errMsg = String(e?.errMsg || e?.message || '')
        if (/\bcancel(?:led|ed)?\b/i.test(errMsg)) return
        const errCode = e?.errCode ?? e?.errno ?? null
        this.setData({
          error: '微信选图失败，请重试',
          pickerError: { api: 'chooseMedia', count, errCode, errMsg: errMsg.slice(0, 300) },
        })
      } else {
        this.setData({ error: e.message || '无法读取照片' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },
  copyPickerError() {
    const report = this.data.pickerError
    if (!report) return
    const appInfo = wx.getAppBaseInfo?.() || {}
    wx.setClipboardData({
      data: JSON.stringify(
        {
          platform: wx.getDeviceInfo?.()?.platform || 'unknown',
          wechatVersion: appInfo.version || '',
          sdkVersion: appInfo.SDKVersion || '',
          ...report,
        },
        null,
        2,
      ),
    })
  },
  copyMetadataReport() {
    const report = this.data.photos[this.data.activePhotoIndex]?.metadataReport
    if (!report) return
    const device = wx.getDeviceInfo?.() || {}
    wx.setClipboardData({
      data: JSON.stringify({ platform: device.platform || 'unknown', ...report }, null, 2),
    })
  },
  removePhoto(e) {
    if (this.data.saving || this.data.loading) return
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos.filter((_, i) => i !== index)
    this.setData({ photos })
    this.showPhoto(
      Math.max(
        0,
        Math.min(
          this.data.activePhotoIndex - (index < this.data.activePhotoIndex ? 1 : 0),
          photos.length - 1,
        ),
      ),
    )
  },
  previewPhoto(e) {
    const urls = this.data.photos.map((photo) => photo.path)
    wx.previewImage({ current: urls[Number(e.currentTarget.dataset.index)], urls })
  },
  async chooseLocation() {
    if (this.data.saving || this.data.loading) return
    this.setData({ loading: true, error: '', pickerError: null })
    try {
      const place = await callApi('chooseLocation')
      let region = {}
      try {
        region = await api.location(place.latitude, place.longitude)
      } catch (_) {}
      this.updateActive({
        city: place.name || place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        provinceName: region.provinceName || '',
        cityName: region.cityName || '',
        error: '',
      })
      this.refreshLocationPermission()
    } catch (e) {
      this.showLocationError(e, '地点选择失败')
    } finally {
      this.setData({ loading: false })
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
    if (this.data.editingId && (!this.data.city || !this.data.takenOn)) {
      this.setData({ error: '请补充拍摄地点和日期' })
      return
    }
    if (!this.data.editingId) {
      const missing = this.data.photos.findIndex(
        (photo) =>
          !photo.city || !photo.takenOn || photo.latitude == null || photo.longitude == null,
      )
      if (missing >= 0) {
        this.showPhoto(missing)
        this.setData({ error: `第 ${missing + 1} 张照片的拍摄日期或地点尚未完善，请补充后保存` })
        return
      }
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
            city: photo.city,
            caption: photo.caption || '',
            takenOn: photo.takenOn,
            latitude: photo.latitude,
            longitude: photo.longitude,
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
        this.showPhoto(0)
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
