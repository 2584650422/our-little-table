const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm')
function inbox() {
  let definition, response = [], reads = [], navigated = '', interval
  const seen = new Set()
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/thought-inbox/thought-inbox'), 'utf8'), {
    Component: (d) => { definition = d },
    require: () => ({ unread: async () => ({ items: response }), unseen: (items) => items.filter((i) => !seen.has(i.id)), dismiss: (items) => items.forEach((i) => seen.add(i.id)), read: async (ids) => reads.push(...ids) }),
    getApp: () => ({ loginPromise: Promise.resolve() }), wx: { getStorageSync: () => ({ coupleId: 7 }), navigateTo: (o) => { navigated = o.url } },
    setInterval: (fn) => { interval = fn; return 1 }, clearInterval() {},
  })
  const c = { ...definition.methods, data: structuredClone(definition.data), setData(u) { Object.assign(this.data, u) }, triggerEvent() {} }
  return { c, reads, respond(items) { response = items }, navigated: () => navigated }
}
test('inbox dismissal does not mark read or repeat within the same session, confirmation reads only the shown item', async () => {
  const r = inbox(); r.c._active = true
  r.respond([{ id: 1 }, { id: 2 }]); await r.c.check()
  assert.equal(r.c.data.item.id, 1); assert.deepEqual(r.reads, [])
  r.c.close(); await r.c.check(); assert.equal(r.c.data.item, null)
  r.respond([{ id: 3 }]); await r.c.check(); await r.c.confirm()
  assert.deepEqual(r.reads, [3]); assert.equal(r.c.data.item, null)
})
test('reply action confirms the displayed popup message and routes to its thread', async () => {
  const r = inbox(); r.c._active = true; r.respond([{ id: 3 }]); await r.c.check(); await r.c.open()
  assert.match(r.navigated(), /focusId=3/); assert.deepEqual(r.reads, [3])
})
test('composer retry preserves the request ID after a network error', async () => {
  let definition, fail = true, sent = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/thought-compose/thought-compose'), 'utf8'), {
    Component: (d) => { definition = d }, require: () => ({ send: async (body) => { sent.push(body); if (fail) throw Error('offline'); return { id: 8 } } }), wx: { showToast() {} },
  })
  const c = { ...definition.methods, data: { content: '你好', sending: false, rootId: 0 }, setData(u) { Object.assign(this.data, u) }, triggerEvent() {} }
  await c.send(); fail = false; await c.send()
  assert.equal(sent[0].requestId, sent[1].requestId)
  c.input({ detail: { value: '改过内容' } }); await c.send(); assert.notEqual(sent[1].requestId, sent[2].requestId)
})
test('read receipts only include recipient text visible in the viewport', async () => {
  const { visibleUnread } = require('../miniprogram/utils/thought-reading')
  const old = global.wx
  global.wx = { getStorageSync: () => ({ id: 1 }), getWindowInfo: () => ({ windowHeight: 800 }) }
  const rects = [{ dataset: { id: 1 }, top: 50, bottom: 90 }, { dataset: { id: 2 }, top: 850, bottom: 900 }, { dataset: { id: 3 }, top: 30, bottom: 70 }]
  const query = { selectAll() { return this }, fields() { return this }, exec(cb) { cb([rects]) } }
  try {
    const ids = await visibleUnread({ createSelectorQuery: () => query }, '.text', [{ id: 1, recipientId: 1 }, { id: 2, recipientId: 1 }, { id: 3, recipientId: 2 }])
    assert.deepEqual(ids, [1])
  } finally { global.wx = old }
})
