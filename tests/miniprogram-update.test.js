// Node 自带测试器模拟微信更新回调，验证生命周期与弹窗竞态，不访问微信后台。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../miniprogram/services/updates.js'), 'utf8')

function runtime(overrides = {}) {
  const callbacks = {}, modals = [], restarts = []
  let registrations = 0, applied = 0
  const manager = {
    onCheckForUpdate(fn) { registrations++; callbacks.check = fn },
    onUpdateReady(fn) { callbacks.ready = fn },
    onUpdateFailed(fn) { callbacks.failed = fn },
    applyUpdate() { applied++ }
  }
  const storage = { token: 'saved-login', today_menu: [{ dishId: 1, quantity: 2 }] }
  const wx = {
    getUpdateManager: () => manager,
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release', version: '1.0.0' } }),
    showModal: options => modals.push(options),
    restartMiniProgram: options => restarts.push(options),
    // 若代码尝试清理登录或点菜单，这个测试立即失败。
    clearStorageSync: () => assert.fail('不能为更新代码包清空业务数据'),
    removeStorageSync: () => assert.fail('不能为更新代码包删除业务数据'),
    ...overrides
  }
  const sandbox = { wx, module: { exports: {} }, console: { info() {} } }
  vm.runInNewContext(source, sandbox)
  return { updates: sandbox.module.exports, callbacks, modals, restarts, storage,
    applied: () => applied, registrations: () => registrations }
}

test('下载期间不重启，确认下载就绪提示后应用更新并保留业务数据', () => {
  const r = runtime()
  r.updates.onShow()
  r.callbacks.check({ hasUpdate: true })
  assert.equal(r.updates.snapshot().status, 'downloading')
  assert.equal(r.applied(), 0)
  r.callbacks.ready()
  assert.equal(r.modals.length, 1)
  r.modals[0].success({ confirm: true })
  assert.equal(r.applied(), 1)
  assert.equal(r.restarts.length, 0)
  assert.equal(r.storage.token, 'saved-login')
  assert.equal(r.storage.today_menu.length, 1)
})

test('后台下载完成，返回前台才显示重启提示；稍后更新后再次进入补提示', () => {
  const r = runtime()
  r.updates.onShow()
  r.updates.onHide()
  r.callbacks.ready()
  assert.equal(r.modals.length, 0)
  r.updates.onShow()
  r.modals[0].success({ confirm: false })
  assert.equal(r.applied(), 0)
  r.updates.onHide()
  r.updates.onShow()
  assert.equal(r.modals.length, 2)
  assert.equal(r.registrations(), 1)
})

test('重启弹窗显示失败后，下次进入仍能提示', () => {
  const r = runtime()
  r.updates.onShow()
  r.callbacks.ready()
  r.modals[0].fail()
  r.updates.onHide()
  r.updates.onShow()
  assert.equal(r.modals.length, 2)
})

test('下载提示打开期间就绪，关闭旧提示后立即补上重启提示', () => {
  const r = runtime()
  r.updates.onShow()
  r.callbacks.check({ hasUpdate: true })
  r.updates.open()
  r.callbacks.ready()
  assert.equal(r.modals.length, 1)
  r.modals[0].success({ confirm: true })
  assert.equal(r.modals.length, 2)
  assert.equal(r.modals[1].title, '新版本已准备好')
  r.modals[1].success({ confirm: true })
  assert.equal(r.applied(), 1)
})

test('反复检查与失败回调不能把已就绪包的状态覆盖掉', () => {
  const r = runtime()
  r.updates.onShow()
  r.callbacks.ready()
  r.callbacks.check({ hasUpdate: false })
  r.callbacks.failed()
  assert.equal(r.updates.snapshot().status, 'ready')
  assert.equal(r.modals.length, 1)
})

test('下载失败后提供实际重启入口，没有新包时不调用 applyUpdate', () => {
  const r = runtime()
  r.updates.onShow()
  r.callbacks.failed()
  assert.equal(r.updates.snapshot().status, 'failed')
  r.modals[0].success({ confirm: true })
  assert.equal(r.restarts.length, 1)
  assert.equal(r.applied(), 0)
  r.restarts[0].fail()
  assert.equal(r.modals[1].title, '请重新打开小饭桌')
})

test('旧客户端缺少更新或重启接口时有手动重新进入指引', () => {
  const r = runtime({ getUpdateManager: undefined, restartMiniProgram: undefined })
  r.updates.onShow()
  assert.equal(r.updates.snapshot().status, 'unsupported')
  r.updates.open()
  r.modals[0].success({ confirm: true })
  assert.equal(r.modals[1].title, '请重新打开小饭桌')
})

test('明确区分体验版，并订阅实时更新状态且可移除监听', () => {
  const r = runtime({ getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) })
  const states = []
  const unsubscribe = r.updates.subscribe(info => states.push(info.status))
  r.updates.onShow()
  assert.equal(r.updates.snapshot().channel, '体验版')
  r.callbacks.check({ hasUpdate: true })
  assert.deepEqual(states, ['checking', 'downloading'])
  unsubscribe()
  r.callbacks.ready()
  assert.deepEqual(states, ['checking', 'downloading'])
})
