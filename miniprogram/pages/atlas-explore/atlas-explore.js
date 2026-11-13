const api = require('../../services/life')
const life = require('../../utils/life')
const { albums } = require('../../utils/atlas-albums')
Page({
  data: {
    level: 'country',
    province: '',
    place: null,
    groups: [],
    regions: [],
    photos: [],
    loading: true,
    error: '',
    topInset: 8,
    rightInset: 110,
    leftInset: 14,
    hasMore: false,
    viewerOpen: false,
    photoIndex: 0,
    placePhotoIndex: 0,
    photoFrameWidth: 320,
    photoFrameHeight: 180,
    photoScale: 1,
    photoZoomed: false,
    loadedPhotos: {},
    failedPhotos: {},
  },
  onLoad(options) {
    this._albums = albums([])
    this._photos = []
    this._initial = { ...options, province: decodeURIComponent(options.province || '') }
    this.updateInsets()
    const channel = this.getOpenerEventChannel()
    channel?.on('atlasPhotos', (payload) => {
      this._photos = payload.photos || []
      this.rebuild()
    })
    this.load()
  },
  onShow() {
    if (this._refreshNeeded) {
      this._refreshNeeded = false
      this.load()
    }
  },
  async managePhoto(event) {
    const id = event.currentTarget.dataset.id
    const selected = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['编辑照片信息', '删除照片'],
        success: resolve,
        fail: () => resolve(null),
      }),
    )
    if (!selected) return
    if (selected.tapIndex === 0) {
      this._refreshNeeded = true
      const photo = this.data.photos.find((item) => String(item.id) === String(id))
      wx.navigateTo({
        url: '/pages/photo-edit/photo-edit?id=' + id,
        success: (result) => result.eventChannel.emit('editPhoto', photo),
      })
      return
    }
    const answer = await new Promise((resolve) =>
      wx.showModal({
        title: '删除这张照片？',
        content: '双方的足迹相册都会移除这张照片，删除后无法恢复。',
        success: resolve,
      }),
    )
    if (!answer.confirm) return
    try {
      await api.deletePhoto(id)
      this.setData({ viewerOpen: false })
      await this.load()
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败，请重试', icon: 'none' })
    }
  },
  onReady() {
    this.updateInsets()
    this.selectComponent('#explore-board')?.resize()
    this.measurePlacePhoto()
  },
  updateInsets() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    let capsule
    try {
      capsule = wx.getMenuButtonBoundingClientRect()
    } catch (_) {}
    this.setData({
      topInset: Math.max(8, capsule?.top || info.statusBarHeight || 8),
      rightInset: capsule ? Math.max(104, info.windowWidth - capsule.left + 12) : 110,
      leftInset: Math.max(/iPhone/i.test(device.model || '') ? 44 : 14, info.safeArea?.left || 0),
    })
  },
  onResize() {
    this.updateInsets()
    this.selectComponent('#explore-board')?.resize()
    this.measurePlacePhoto()
  },
  onUnload() {
    this._gone = true
    clearTimeout(this._transitionTimer)
  },
  async load() {
    try {
      await getApp().loginPromise
      if (!life.requireCouple()) {
        this.setData({ loading: false })
        return
      }
      // Fetch remaining pages progressively, so country/province counts include all saved photos.
      let photos = [],
        before = 0,
        more = true
      while (more && !this._gone) {
        const result = await api.photos(before)
        if (this._gone) return
        const items = result.items || []
        photos = photos.concat(items)
        more = !!result.hasMore && items.length > 0
        const next = items[items.length - 1]?.id
        if (more && next === before) throw new Error('照片分页暂时异常，请重试')
        before = next
        this._photos = photos
        this.rebuild()
        this.setData({ loading: more, hasMore: more, error: '' })
      }
    } catch (error) {
      if (!this._gone) this.setData({ loading: false, error: error.message })
    }
  },
  rebuild() {
    this._albums = albums(this._photos || [])
    if (this._initial) {
      const options = this._initial
      this._initial = null
      const region = this._albums.regions.find((item) => item.name === options.province)
      if (region) {
        this.data.province = region.name
        this.data.level = 'province'
      }
      const place = this._albums.places.find((item) => item.id === options.place)
      if (place) {
        this.data.province = place.province
        this.data.level = 'place'
        this.data.place = place
      }
    }
    const region = this._albums.regions.find((item) => item.name === this.data.province)
    const place = this._albums.places.find((item) => item.id === this.data.place?.id)
    let level = this.data.level
    if (level === 'place' && !place) level = region ? 'province' : 'country'
    this.setData(
      {
        level,
        province: place?.province || this.data.province,
        regions: this._albums.regions,
        groups:
          level === 'country'
            ? this._albums.regions
            : level === 'province'
              ? region?.places || []
              : [],
        place: place || null,
        photos: place?.photos || [],
        placePhotoIndex: Math.min(
          this.data.placePhotoIndex,
          Math.max(0, (place?.photos.length || 0) - 1),
        ),
      },
      () => this.measurePlacePhoto(),
    )
  },
  provinceSelect(event) {
    if (this.data.level === 'country') this.openProvince(event.detail.province)
  },
  groupSelect(event) {
    if (this.data.level === 'country') return this.openProvince(event.detail.id)
    const place = this._albums.places.find((item) => String(item.id) === String(event.detail.id))
    if (this.data.level !== 'province' || !place || place.province !== this.data.province) return
    this.setData(
      { level: 'place', place, photos: place.photos, groups: [], placePhotoIndex: 0 },
      () => this.measurePlacePhoto(),
    )
  },
  openProvince(province) {
    if (this.data.level === 'place') return
    const region = this._albums.regions.find((item) => item.name === province)
    this.setData({
      level: 'province',
      province,
      groups: region?.places || [],
      place: null,
      photos: [],
    })
  },
  back() {
    if (this.data.viewerOpen) return this.closePhoto()
    if (this.data.level === 'place') {
      const region = this._albums.regions.find((item) => item.name === this.data.province)
      this.setData({ level: 'province', place: null, photos: [], groups: region?.places || [] })
    } else if (this.data.level === 'province') this.country()
    else wx.navigateBack()
  },
  country() {
    this.setData({
      level: 'country',
      province: '',
      place: null,
      photos: [],
      groups: this._albums?.regions || [],
    })
  },
  close() {
    wx.navigateBack()
  },
  preview(event) {
    const photoIndex = this.data.photos.findIndex(
      (item) => String(item.id) === String(event.currentTarget.dataset.id),
    )
    if (photoIndex >= 0)
      this.setData({ viewerOpen: true, photoIndex, photoScale: 1, photoZoomed: false })
  },
  closePhoto() {
    this.setData({ viewerOpen: false })
  },
  photoChange(event) {
    this.setData({ photoIndex: event.detail.current, photoScale: 1, photoZoomed: false })
  },
  measurePlacePhoto() {
    if (this.data.level !== 'place' || !this.createSelectorQuery) return
    this.createSelectorQuery()
      .select('.place-swiper')
      .boundingClientRect()
      .exec((rects) => {
        if (!rects[0]?.width || !rects[0]?.height) return
        this._photoBounds = rects[0]
        this.fitPlacePhoto()
      })
  },
  fitPlacePhoto() {
    const photo = this.data.photos[this.data.placePhotoIndex]
    if (!photo || !this._photoBounds) return
    const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 16 / 9
    const availableWidth = Math.max(1, this._photoBounds.width - 10)
    const availableHeight = Math.max(1, this._photoBounds.height - 38)
    const photoFrameWidth = Math.min(availableWidth, availableHeight * ratio)
    this.setData({ photoFrameWidth, photoFrameHeight: photoFrameWidth / ratio })
  },
  placePhotoChange(event) {
    this.setData({ placePhotoIndex: event.detail.current }, () => this.fitPlacePhoto())
  },
  choosePhoto(event) {
    this.setData({
      photoIndex: Number(event.currentTarget.dataset.index),
      photoScale: 1,
      photoZoomed: false,
    })
  },
  photoZoom(event) {
    const photoZoomed = event.detail.scale > 1.03
    if (photoZoomed !== this.data.photoZoomed) this.setData({ photoZoomed })
  },
  previousPhoto() {
    this.setData({
      photoIndex: Math.max(0, this.data.photoIndex - 1),
      photoScale: 1,
      photoZoomed: false,
    })
  },
  nextPhoto() {
    this.setData({
      photoIndex: Math.min(this.data.photos.length - 1, this.data.photoIndex + 1),
      photoScale: 1,
      photoZoomed: false,
    })
  },
  originalLoaded(event) {
    const id = event.currentTarget.dataset.id
    this.setData({ ['loadedPhotos.' + id]: true, ['failedPhotos.' + id]: false })
  },
  originalFailed(event) {
    this.setData({ ['failedPhotos.' + event.currentTarget.dataset.id]: true })
  },
})
