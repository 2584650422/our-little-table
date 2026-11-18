const { request } = require('./api')
let seen = new Set()
const avatarCache = new Map()
function stableAvatars(result) {
  const now = Date.now()
  function item(row) {
    const url = row.senderAvatarUrl
    if (url) {
      const key = row.senderId
      const path = url.split('?')[0]
      const cached = avatarCache.get(key)
      if (cached && cached.path === path && cached.until > now) row.senderAvatarUrl = cached.url
      else avatarCache.set(key, { path, url, until: now + 4 * 60 * 1000 })
    }
    if (row.replies) row.replies.forEach(item)
  }
  ;(result.items || []).forEach(item)
  return result
}
module.exports = {
  list: (data) => request({ url: '/api/thoughts', data }).then(stableAvatars),
  unread: () => request({ url: '/api/thoughts/unread' }).then(stableAvatars),
  day: (date) => request({ url: '/api/thoughts/day', data: { date } }).then(stableAvatars),
  month: (month) => request({ url: '/api/thoughts/calendar', data: { month } }),
  send: (data) => request({ url: '/api/thoughts', method: 'POST', data }),
  read: (ids) => request({ url: '/api/thoughts/read', method: 'PUT', data: { ids } }),
  remove: (id) => request({ url: '/api/thoughts/' + id, method: 'DELETE' }),
  beginSession() {
    seen = new Set()
  },
  unseen(items) {
    return items.filter((item) => !seen.has(item.id))
  },
  dismiss(items) {
    items.forEach((item) => seen.add(item.id))
  },
}
