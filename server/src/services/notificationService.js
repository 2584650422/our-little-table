const db = require('../config/db')
const { sendOrderMessage } = require('../integrations/wechat/client')

async function notifyNewOrder(target, order) {
  if (!target) return { sent: false, reason: '另一位成员尚未加入' }
  await db.query('INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (?,\'new_order\',?,?,?)', [target.id, '今天想吃这些', order.dishNames, order.id])
  try { return await sendOrderMessage(target.openid, order) }
  catch (error) { console.warn('subscribe message skipped:', error.message); return { sent: false, reason: '微信提醒发送失败，小程序内提醒已送达' } }
}

async function notifyOrderCreated(creator, target, order) {
  await db.query('INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (?,\'order_created\',?,?,?)', [creator.id, '点菜成功啦', `已提交：${order.dishNames}`, order.id])
  const targetResult = await notifyNewOrder(target, order)
  return { creator: { sent: true, channel: 'in_app' }, target: targetResult }
}

async function notifyOrderServed(order, servedById) {
  const [members] = await db.query('SELECT user_id AS userId FROM couple_members WHERE couple_id=? AND left_at IS NULL AND user_id<>?', [order.coupleId, servedById])
  await Promise.all(members.map(member => db.query('INSERT INTO notifications (user_id,type,title,content,order_id) VALUES (?,\'order_served\',?,?,?)', [member.userId, '上菜成功啦', order.dishNames, order.id])))
}

module.exports = { notifyOrderCreated, notifyOrderServed }
