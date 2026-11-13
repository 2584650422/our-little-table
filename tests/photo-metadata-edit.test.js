const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function setup(api) {
  let definition,
    uploads = 0,
    returns = 0
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/photo-edit/photo-edit.js', 'utf8'), {
    Page: (d) => (definition = d),
    getApp: () => ({ loginPromise: Promise.resolve() }),
    wx: {
      setNavigationBarTitle() {},
      showToast() {},
      navigateBack() {
        returns++
      },
    },
    require: (path) =>
      path.endsWith('services/life')
        ? api
        : path.endsWith('utils/life')
          ? { date: () => '2026-11-06' }
          : path.endsWith('services/upload')
            ? {
                uploadTravelPhoto() {
                  uploads++
                  throw Error('must not upload')
                },
              }
            : {},
  })
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(data) {
      Object.assign(this.data, data)
    },
  }
  return { page, uploads: () => uploads, returns: () => returns }
}
const saved = {
  previewUrl: 'https://example.invalid/preview',
  width: 3000,
  height: 2000,
  city: '北京',
  latitude: 39.9,
  longitude: 116.4,
  takenOn: '2020-01-01',
  caption: '原描述',
}
test('editing an existing photograph loads metadata and updates without uploading image bytes', async () => {
  let call
  const state = setup({
    photo: async (id) => {
      assert.equal(id, '9')
      return saved
    },
    updatePhoto: async (id, data) => (call = { id, data }),
  })
  await state.page.onLoad({ id: '9' })
  state.page.field({
    currentTarget: { dataset: { field: 'takenOn' } },
    detail: { value: '2020-01-02' },
  })
  state.page.field({
    currentTarget: { dataset: { field: 'caption' } },
    detail: { value: '更正后的描述' },
  })
  await state.page.save()
  assert.equal(call.id, '9')
  assert.equal(call.data.takenOn, '2020-01-02')
  assert.equal(call.data.city, '北京')
  assert.equal(call.data.caption, '更正后的描述')
  assert.equal(state.uploads(), 0)
  assert.equal(state.returns(), 1)
})
test('failed metadata save preserves the form for retry', async () => {
  const state = setup({
    photo: async () => saved,
    updatePhoto: async () => {
      throw Error('服务暂不可用')
    },
  })
  await state.page.onLoad({ id: '9' })
  state.page.field({
    currentTarget: { dataset: { field: 'caption' } },
    detail: { value: '修改描述' },
  })
  await state.page.save()
  assert.equal(state.page.data.saving, false)
  assert.equal(state.page.data.city, '北京')
  assert.equal(state.page.data.error, '服务暂不可用')
  assert.equal(state.returns(), 0)
  assert.equal(state.uploads(), 0)
})

test('unchanged edits cannot save and reverting a field disables saving again', async () => {
  let writes = 0
  const state = setup({ photo: async () => saved, updatePhoto: async () => writes++ })
  await state.page.onLoad({ id: '9' })
  await state.page.save()
  assert.equal(writes, 0)
  const change = (value) =>
    state.page.field({ currentTarget: { dataset: { field: 'caption' } }, detail: { value } })
  change('修改描述')
  assert.equal(state.page.data.hasChanges, true)
  change(saved.caption)
  assert.equal(state.page.data.hasChanges, false)
  await state.page.save()
  assert.equal(writes, 0)
})
test('photo passed by the opener fills the edit form without a detail request', async () => {
  let requests = 0
  const state = setup({
    photo: async () => {
      requests++
      throw Error('网络错误')
    },
  })
  state.page.getOpenerEventChannel = () => ({
    on: (name, callback) => {
      assert.equal(name, 'editPhoto')
      callback(saved)
    },
  })
  await state.page.onLoad({ id: '9' })
  assert.equal(requests, 0)
  assert.equal(state.page.data.city, saved.city)
  assert.equal(state.page.data.takenOn, saved.takenOn)
  assert.equal(state.page.data.caption, saved.caption)
  assert.equal(state.page.data.error, '')
})
