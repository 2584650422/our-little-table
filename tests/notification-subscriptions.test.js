const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function runtime({ balances = {}, preferences = {}, mode = 'batch', decisions = {}, failAt = 0 } = {}) {
  const calls = [], registrations = []
  let gesture = false
  const credits = { ...balances }
  const events = { 'order-template': 'created', 'served-template': 'served', 'thought-template': 'thought' }
  const config = {
    orderTemplateId: 'order-template', servedTemplateId: 'served-template',
    thoughtTemplateId: 'thought-template', subscriptionCreditMax: 10, preferences,
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/notifications'), 'utf8'), {
    module, Date, Math, console,
    require: () => ({ request: async ({ url, data }) => {
      if (url.endsWith('/config')) return { ...config, subscriptionCredits: { ...credits } }
      assert.ok(url.endsWith('/subscriptions'))
      registrations.push(Array.from(data.templateIds))
      const addedByEvent = {}
      for (const id of data.templateIds) {
        const event = events[id]
        assert.ok(event)
        credits[event] = (credits[event] || 0) + 1
        addedByEvent[event] = 1
      }
      return { subscriptionCredits: { ...credits }, addedByEvent, addedCount: data.templateIds.length }
    } }),
    wx: { getDeviceInfo: () => ({ platform: 'devtools' }), requestSubscribeMessage: ({ tmplIds, success, fail }) => {
      assert.equal(gesture, true, 'native request must run synchronously during the tap')
      calls.push(Array.from(tmplIds))
      if (calls.length === failAt) return fail()
      const ids = mode === 'batch' ? tmplIds : tmplIds.slice(0, 1)
      success(Object.fromEntries(ids.map(id => [id, decisions[id] || 'accept'])))
    } },
  })
  return { service: module.exports, calls, registrations, credits,
    tap(events = all) {
      gesture = true
      const promise = module.exports.authorizeAtAction(events)
      gesture = false
      return promise
    },
  }
}
const all = ['created', 'served', 'thought']
async function ready(r) { await r.service.loadConfig(true); return r }

test('点击内同步一次申请三类，真实批量同意后各登记一次', async () => {
  const r = await ready(runtime())
  const result = await r.tap()
  assert.deepEqual(r.calls, [['order-template', 'served-template', 'thought-template']])
  assert.deepEqual(r.credits, { created: 1, served: 1, thought: 1 })
  assert.equal(result.accepted, 3)
})
test('模拟器仅返回首项时不自动再弹窗，不伪造其他两类授权', async () => {
  const r = await ready(runtime({ mode: 'first' }))
  const result = await r.tap()
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.credits, { created: 1 })
  assert.deepEqual(Array.from(result.unfinishedEvents), ['served', 'thought'])
  assert.equal(result.statusByEvent.served, 'missing')
  assert.equal(result.isDevtools, true)
})
test('未预载配置时不在点击后发网络请求再尝试弹窗', async () => {
  const r = runtime()
  const result = await r.tap()
  assert.equal(result.configFailed, true)
  assert.equal(r.calls.length, 0)
})
test('跳过满额和关闭的类别', async () => {
  const r = await ready(runtime({ balances: { created: 10 }, preferences: { served: false } }))
  await r.tap()
  assert.deepEqual(r.calls, [['thought-template']])
})
test('明确拒绝与模板过滤分别返回原始状态，不当作已获授权', async () => {
  const r = await ready(runtime({ decisions: { 'served-template': 'reject', 'thought-template': 'filter' } }))
  const result = await r.tap()
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.credits, { created: 1 })
  assert.equal(result.statusByEvent.served, 'reject')
  assert.equal(result.statusByEvent.thought, 'filter')
})
test('原生接口失败不登记授权，返回调用失败状态', async () => {
  const r = await ready(runtime({ failAt: 1 }))
  const result = await r.tap()
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.credits, {})
  assert.equal(result.statusByEvent.thought, 'failed')
})
test('指定类别补充不会申请其他类别', async () => {
  const r = await ready(runtime({ balances: { thought: 8 } }))
  await r.tap(['thought'])
  assert.deepEqual(r.calls, [['thought-template']])
  assert.equal(r.credits.thought, 9)
})
test('重复点击同一流程只申请并登记一轮', async () => {
  const r = await ready(runtime())
  const a = r.tap(), b = r.tap()
  assert.equal(a, b)
  await Promise.all([a, b])
  assert.deepEqual(r.credits, { created: 1, served: 1, thought: 1 })
})
