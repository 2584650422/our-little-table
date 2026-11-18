const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
function runtime(missing = false, pickerFailure) {
  let definition
  let copied
  const saved = [], uploads = []
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/photo-edit/photo-edit.js', 'utf8'), {
    Page: value => { definition = value },
    getApp: () => ({ loginPromise: Promise.resolve() }),
    wx: {
      chooseMedia: o => {
        assert.equal(o.count, 9)
        assert.equal(o.sizeType.join(','), 'original')
        assert.equal(o.sourceType.join(','), 'album,camera')
        assert.equal(o.mediaType.join(','), 'image')
        if (pickerFailure) return o.fail(pickerFailure)
        o.success({ tempFiles: [{ tempFilePath: 'a.jpg', size: 100 }, { tempFilePath: 'b.jpg', size: 100 }] })
      },
      setClipboardData: o => { copied = JSON.parse(o.data) },
      getImageInfo: o => o.success({ width: 1000, height: 800, type: 'jpeg' }),
      chooseLocation: o => o.success({ name: '手动选的公园', latitude: 31.2, longitude: 121.4 }),
      getSetting: o => o.success({ authSetting: {} }), navigateBack() {},
    },
    require: name => name.endsWith('services/life') ? {
      location: async (latitude) => ({ provinceName: latitude > 31 ? '上海市' : '四川省', cityName: latitude > 31 ? '上海市' : '成都市' }),
      addPhoto: async photo => saved.push(photo),
    } : name.endsWith('utils/life') ? { date: () => '2026-11-18' }
      : name.endsWith('photo-metadata') ? { readMetadata: async path => path === 'a.jpg'
        ? { takenOn: '2020-01-01', latitude: 30.6, longitude: 104.0 }
        : missing ? {} : { takenOn: '2025-05-05', latitude: 31.2, longitude: 121.4 } }
      : name.endsWith('services/upload') ? { uploadTravelPhoto: async path => { uploads.push(path); return { originalKey: path, previewKey: path + '.preview' } } }
      : { request: async () => {} },
  })
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values) } }
  return { page, saved, uploads, copied: () => copied }
}
const input = (page, field, value) => page.field({ currentTarget: { dataset: { field } }, detail: { value } })
test('批量照片各自使用EXIF日期地点，逐张编辑备注后保存不混用信息', async () => {
  const { page, saved } = runtime()
  await page.choose()
  assert.equal(page.data.photos[0].metadataReport.api, 'chooseMedia')
  assert.equal(page.data.photos[0].takenOn, '2020-01-01')
  assert.equal(page.data.photos[1].takenOn, '2025-05-05')
  input(page, 'caption', '第一张')
  page.selectPhoto({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.takenOn, '2025-05-05')
  input(page, 'caption', '第二张')
  await page.save()
  assert.deepEqual(saved.map(p => [p.originalKey, p.takenOn, p.latitude, p.caption]), [
    ['a.jpg', '2020-01-01', 30.6, '第一张'], ['b.jpg', '2025-05-05', 31.2, '第二张'],
  ])
})
test('微信选图失败时可复制错误，取消时不报错', async () => {
  const errMsg = 'chooseMedia:fail api scope is not declared in the privacy agreement'
  const { page, copied } = runtime(false, { errno: 112, errMsg })
  await page.choose()
  assert.match(page.data.error, /选图失败/)
  assert.equal(page.data.loading, false)
  page.copyPickerError()
  assert.equal(copied().api, 'chooseMedia')
  assert.equal(copied().errCode, 112)
  assert.equal(copied().errMsg, errMsg)
  const cancelled = runtime(false, { errMsg: 'chooseMedia:fail cancel' }).page
  await cancelled.choose()
  assert.equal(cancelled.data.error, '')
  assert.equal(cancelled.data.pickerError, null)
})
test('无元数据时不默认当前日期，不上传；定位到缺失照片供手动补充', async () => {
  const { page, saved, uploads } = runtime(true)
  await page.choose()
  assert.equal(page.data.photos[0].metadataReport.source, 'album')
  await page.save()
  assert.equal(page.data.activePhotoIndex, 1)
  assert.equal(page.data.takenOn, '')
  assert.equal(page.data.city, '')
  assert.equal(uploads.length, 0)
  input(page, 'takenOn', '2019-02-03')
  await page.chooseLocation()
  assert.equal(page.data.photos[0].latitude, 30.6)
  assert.equal(page.data.photos[1].city, '手动选的公园')
  assert.equal(page.data.cityName, '上海市')
  await page.save()
  assert.deepEqual(saved.map(p => p.takenOn), ['2020-01-01', '2019-02-03'])
})
