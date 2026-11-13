// Only return messages whose text has entered the current visible viewport.
function visibleUnread(page, selector, items, clipSelector) {
  return new Promise((resolve) => {
    if (!page.createSelectorQuery) return resolve([])
    const userId = wx.getStorageSync('user')?.id
    const unread = new Set(
      items.filter((i) => i.recipientId === userId && !i.readAt).map((i) => i.id),
    )
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const query = page.createSelectorQuery()
    if (clipSelector) query.select(clipSelector).boundingClientRect()
    query
      .selectAll(selector)
      .fields({ rect: true, size: true, dataset: true })
      .exec((results) => {
        const clip = clipSelector ? results[0] : null
        const top = Math.max(0, clip?.top || 0)
        const bottom = Math.min(info.windowHeight, clip?.bottom ?? info.windowHeight)
        const visible = (results[results.length - 1] || []).filter(
          (r) => r.bottom > top && r.top < bottom,
        )
        resolve(visible.map((r) => Number(r.dataset.id)).filter((id) => unread.has(id)))
      })
  })
}
module.exports = { visibleUnread }
