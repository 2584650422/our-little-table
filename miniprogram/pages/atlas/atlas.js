const api = require('../../services/life')
const life = require('../../utils/life')
const { albums, sortPhotos } = require('../../utils/atlas-albums')

Page({
  data: {
    groups: [],
    photos: [],
    columns: [[], []],
    pins: [],
    selected: null,
    storyPhotos: [],
    storyIndex: 0,
    storyImageHeight: 400,
    highlightProvince: '',
    filterProvince: '',
    provincePhotoCount: 0,
    view: 'map',
    mapScale: 1,
    mapX: 0,
    mapY: 0,
    hasMore: false,
    loading: false,
    error: '',
    cityCount: 0,
  },
  onShow() {
    this.load()
  },
  onResize() {
    this.selectComponent('#preview-board')?.resize()
  },
  onReachBottom() {
    if (this.data.view === 'wall' && this.data.hasMore && !this.data.loading) this.load(true)
  },
  loadMore() {
    this.load(true)
  },
  async load(append = false) {
    append = append === true
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      await getApp().loginPromise
      if (!life.requireCouple()) {
        this.setData({ loading: false })
        return
      }
      const old = append ? this.data.photos : []
      const result = await api.photos(append && old.length ? old[old.length - 1].id : 0)
      const photos = sortPhotos([...old, ...result.items])
      const columns = [[], []],
        heights = [0, 0]
      photos.forEach((photo) => {
        const col = heights[0] <= heights[1] ? 0 : 1
        columns[col].push(photo)
        heights[col] += photo.height / photo.width + 0.3
      })
      const grouped = albums(photos)
      this._albums = grouped
      const pins = sortPhotos(grouped.places.flatMap((place) =>
        place.photos.map((photo) => ({ ...photo, province: place.province })),
      ))
      const selected = this.data.filterProvince
        ? pins.find(
            (photo) =>
              photo.id === this.data.selected?.id && photo.province === this.data.filterProvince,
          ) ||
          pins.find((photo) => photo.province === this.data.filterProvince) ||
          null
        : pins.find((photo) => photo.id === this.data.selected?.id) || pins[0] || null
      const highlightProvince = this.data.filterProvince || ''
      const provincePhotoCount = pins.filter(
        (photo) => photo.province && photo.province === this.data.filterProvince,
      ).length
      this.setData({
        photos,
        columns,
        pins,
        groups: grouped.regions,
        selected,
        storyPhotos: this.data.filterProvince
          ? pins.filter((photo) => photo.province === this.data.filterProvince)
          : pins,
        storyIndex: Math.max(
          0,
          (this.data.filterProvince
            ? pins.filter((photo) => photo.province === this.data.filterProvince)
            : pins
          ).findIndex((photo) => photo.id === selected?.id),
        ),
        storyImageHeight: this.imageHeight(selected),
        highlightProvince,
        provincePhotoCount,
        hasMore: result.hasMore,
        loading: false,
        cityCount: grouped.cities.length,
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message })
    }
  },
  mode(event) {
    this.setData({ view: event.currentTarget.dataset.mode })
  },
  provinceSelect() {},
  groupSelect(event) {
    this.selectProvince(event.detail.id)
  },
  selectProvince(province) {
    const region = this._albums?.regions.find((item) => item.name === province)
    this.setData({
      filterProvince: province,
      highlightProvince: province,
      provincePhotoCount: region?.count || 0,
      selected: region?.photos[0] || null,
      storyPhotos: region?.photos || [],
      storyIndex: 0,
      storyImageHeight: this.imageHeight(region?.photos[0]),
      groups: this._albums?.regions || [],
    })
  },
  clearProvinceFilter() {
    this.setData({
      filterProvince: '',
      highlightProvince: '',
      provincePhotoCount: 0,
      selected: this.data.pins[0] || null,
      storyPhotos: this.data.pins,
      storyIndex: 0,
      storyImageHeight: this.imageHeight(this.data.pins[0]),
      groups: this._albums?.regions || [],
    })
  },
  imageHeight(photo) {
    return photo?.width && photo?.height
      ? Math.max(260, Math.min(820, (662 * photo.height) / photo.width))
      : 400
  },
  storyChange(event) {
    const storyIndex = event.detail.current
    const selected = this.data.storyPhotos[storyIndex]
    if (selected)
      this.setData({ storyIndex, selected, storyImageHeight: this.imageHeight(selected) })
  },
  fullscreen() {
    const province = encodeURIComponent(this.data.filterProvince || '')
    wx.navigateTo({
      url: '/pages/atlas-explore/atlas-explore?province=' + province,
      success: (result) => result.eventChannel?.emit('atlasPhotos', { photos: this.data.photos }),
    })
  },
  preview(event) {
    const photo =
      this.data.photos.find((item) => item.id === event.currentTarget.dataset.id) ||
      this.data.selected
    if (photo)
      wx.previewImage({
        current: photo.originalUrl,
        urls: (this.data.view === 'map' ? this.data.storyPhotos : this.data.photos).map(
          (item) => item.originalUrl,
        ),
      })
  },
  add() {
    wx.navigateTo({ url: '/pages/photo-edit/photo-edit' })
  },
  edit(event) {
    const id = event.currentTarget.dataset.id
    const photo = this.data.photos.find((item) => String(item.id) === String(id))
    wx.navigateTo({
      url: '/pages/photo-edit/photo-edit?id=' + id,
      success: (result) => result.eventChannel?.emit('editPhoto', photo),
    })
  },
  async managePhoto(event) {
    const result = await new Promise((resolve) =>
      wx.showActionSheet({
        itemList: ['编辑照片信息', '删除照片'],
        success: resolve,
        fail: () => resolve(null),
      }),
    )
    if (result?.tapIndex === 0) this.edit(event)
    if (result?.tapIndex === 1) this.remove(event)
  },
  async remove(event) {
    const id = event.currentTarget.dataset.id
    const result = await new Promise((resolve) =>
      wx.showModal({
        title: '删除这张回忆？',
        content: '双方的相册都会移除这张照片。',
        success: resolve,
      }),
    )
    if (!result.confirm) return
    try {
      await api.deletePhoto(id)
      this.load()
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' })
    }
  },
})
