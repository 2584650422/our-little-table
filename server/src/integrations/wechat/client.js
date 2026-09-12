const axios = require('axios')
const env = require('../../config/env')
const { AppError } = require('../../utils/http')

async function code2Session(code) {
  if (!env.wechat.appId || !env.wechat.appSecret) throw new AppError('微信登录尚未配置', 503)
  const { data } = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
    params: { appid: env.wechat.appId, secret: env.wechat.appSecret, js_code: code, grant_type: 'authorization_code' }, timeout: 8000
  })
  if (data.errcode || !data.openid) throw new AppError(`微信登录失败：${data.errmsg || '无 openid'}`, 401)
  return data
}

let tokenCache = { token: '', expiresAt: 0 }
async function getAccessToken() {
  if (tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token
  const { data } = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid: env.wechat.appId, secret: env.wechat.appSecret }, timeout: 8000
  })
  if (data.errcode || !data.access_token) throw new Error(data.errmsg || 'access token unavailable')
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 7200) * 1000 }
  return tokenCache.token
}

async function sendOrderMessage(openid, order) {
  if (!env.wechat.templateId || !env.wechat.appSecret || Object.values(env.wechat.fields).some(value => !value)) return { sent: false, reason: '微信提醒暂未配置' }
  const token = await getAccessToken()
  const data = {}
  data[env.wechat.fields.meal] = { value: order.title.slice(0, 20) }
  data[env.wechat.fields.dishes] = { value: order.dishNames.slice(0, 20) }
  data[env.wechat.fields.message] = { value: (order.message || '来看看今天的小菜单吧').slice(0, 20) }
  data[env.wechat.fields.date] = { value: order.mealDate }
  const response = await axios.post(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
    touser: openid, template_id: env.wechat.templateId, page: `${env.wechat.page}?id=${order.id}`, data
  }, { timeout: 8000 })
  if (response.data.errcode) throw new Error(response.data.errmsg || 'subscribe message failed')
  return { sent: true }
}

module.exports = { code2Session, sendOrderMessage }
