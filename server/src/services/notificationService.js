const db = require('../config/db')
const { sendOrderMessage } = require('../integrations/wechat/client')

async function notifyNewOrder(target, order) {
  if (!target) return { sent: false, reason: '另一位成员尚未加入' }
  await db.query('INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (?,\'new_order\',?,?,?)', [target.id, '今天想吃这些', order.dishNames, order.id])
  try { return await sendOrderMessage(target.openid, order) }
  catch (error) { console.warn('subscribe message skipped:', error.message); return { sent: false, reason: '微信提醒发送失败，小程序内提醒已送达' } }
}

module.exports = { notifyNewOrder }

