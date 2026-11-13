const { request } = require('./api')

let templateConfig = null
let authorizationInFlight = null
const testSendInFlight = {}

async function loadConfig(refresh = false) {
  if (templateConfig && !refresh) return templateConfig
  templateConfig = await request({ url: '/api/notifications/config' })
  return templateConfig
}

function warmConfig(refresh = true) {
  loadConfig(refresh).catch(() => {})
}

function authorizeAtAction(events = ['created', 'served']) {
  if (authorizationInFlight) return authorizationInFlight
  authorizationInFlight = authorizeOnce(events).finally(() => {
    authorizationInFlight = null
  })
  return authorizationInFlight
}

function requestTemplates(templates) {
  if (typeof wx.requestSubscribeMessage !== 'function')
    return Promise.resolve({ failed: true, statuses: {} })
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds: templates,
        success: (statuses) => resolve({ statuses }),
        fail: (error) => resolve({
          failed: true, statuses: {},
          gestureRequired: /tap gesture/i.test(error?.errMsg || ''),
        }),
      })
    } catch (_) {
      resolve({ failed: true, statuses: {} })
    }
  })
}

async function authorizeOnce(events) {
  // Load on page entry; requesting config here would lose the tap context.
  const config = templateConfig
  if (!config) return { accepted: 0, configFailed: true }
  const credits = config.subscriptionCredits || {}
  const max = config.subscriptionCreditMax || 10
  const candidates = [
    [config.orderTemplateId, 'created'],
    [config.servedTemplateId, 'served'],
    [config.thoughtTemplateId, 'thought'],
  ].filter(([id, event]) =>
    id && events.includes(event) && config.preferences?.[event] !== false &&
    (credits[event] || 0) < max,
  )
  const templates = [...new Set(candidates.map(([id]) => id))]
  if (!templates.length) return { accepted: 0, capped: true }
  const first = await requestTemplates(templates)
  const statuses = { ...first.statuses }
  // Use one native batch request per user tap. Chaining dialogs after its
  // callback does not reliably retain the required user gesture.
  let platform = ''
  try {
    platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync?.())?.platform || ''
  } catch (_) {}
  const statusByEvent = Object.fromEntries(candidates.map(([id, event]) =>
    [event, statuses[id] || (first.gestureRequired ? 'gesture_required' : first.failed ? 'failed' : 'missing')],
  ))
  console.info('wechat.subscription_result', { platform, events: statusByEvent })
  const diagnostics = { statusByEvent, isDevtools: platform === 'devtools' }
  const accepted = templates.filter((id) => ['accept', 'acceptWithAudio'].includes(statuses[id]))
  const unfinishedEvents = candidates
    .filter(([id]) => !accepted.includes(id))
    .map(([, event]) => event)
  if (!accepted.length) return { accepted: 0, unfinishedEvents, ...diagnostics }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  try {
    const registered = await request({
      url: '/api/notifications/subscriptions',
      method: 'POST',
      data: { requestId, templateIds: accepted },
    })
    templateConfig = {
      ...config,
      subscriptionCredits: registered.subscriptionCredits || config.subscriptionCredits,
    }
    return {
      accepted: registered.addedCount || 0,
      addedByEvent: registered.addedByEvent || {},
      unfinishedEvents,
      ...diagnostics,
    }
  } catch (_) {
    console.warn('notification subscription grant was not recorded')
    return { accepted: 0, recordFailed: true, unfinishedEvents, ...diagnostics }
  }
}

function requestOneTemplate(templateId) {
  if (typeof wx.requestSubscribeMessage !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (result) => resolve(['accept', 'acceptWithAudio'].includes(result[templateId])),
        fail: () => resolve(false),
      })
    } catch (error) {
      resolve(false)
    }
  })
}

async function testSend(event) {
  if (testSendInFlight[event]) return testSendInFlight[event]
  testSendInFlight[event] = (async () => {
    const config = templateConfig
    if (!config) return { sent: false, reason: '提醒配置未加载，请重新进入页面' }
    const templateId = {
      created: config.orderTemplateId,
      served: config.servedTemplateId,
      thought: config.thoughtTemplateId,
    }[event]
    if (!templateId) return { sent: false, reason: '微信提醒模板暂未配置' }
    const max = config.subscriptionCreditMax || 10
    let credits = config.subscriptionCredits || {}
    if ((credits[event] || 0) < 1) {
      const accepted = await requestOneTemplate(templateId)
      if (!accepted) return { sent: false, reason: '没有获得该提醒模板的授权' }
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      const registered = await request({
        url: '/api/notifications/subscriptions',
        method: 'POST',
        data: { requestId, templateIds: [templateId] },
      })
      credits = registered.subscriptionCredits || credits
      templateConfig = { ...config, subscriptionCredits: credits }
      if ((credits[event] || 0) < 1)
        return { sent: false, capped: true, reason: `该提醒机会已达到${max}次上限` }
    }
    const result = await request({
      url: '/api/notifications/test-send',
      method: 'POST',
      data: { event },
    })
    templateConfig = { ...config, subscriptionCredits: result.subscriptionCredits || credits }
    return result
  })().finally(() => {
    delete testSendInFlight[event]
  })
  return testSendInFlight[event]
}

function updateCredits(subscriptionCredits) {
  if (templateConfig)
    templateConfig = { ...templateConfig, subscriptionCredits: subscriptionCredits || {} }
}

module.exports = { loadConfig, warmConfig, authorizeAtAction, testSend, updateCredits }
