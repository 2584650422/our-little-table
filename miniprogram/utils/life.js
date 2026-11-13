function date(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function event(e) {
  const createdAt = String(e.createdAt || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  const titles = {
    birthday: '生日',
    anniversary: '纪念日',
    countdown: '倒计时',
    milestone: '里程碑',
    diary: '当天记录',
  }
  return {
    ...e,
    isDiary: e.kind === 'diary',
    creatorLabel: e.creatorName || '记录人',
    creatorInitial: (e.creatorName || '记').slice(0, 1),
    createdAtLabel: createdAt ? `${createdAt[1]} ${createdAt[2]}` : '',
    month: Number(e.nextDate.slice(5, 7)),
    day: e.nextDate.slice(8),
    label: titles[e.kind] || '重要日子',
    daysLabel: e.days === 0 ? '就是今天' : e.days > 0 ? `${e.days} 天后` : `已过 ${-e.days} 天`,
    calendarLabel: e.calendarType === 'lunar' ? '农历' : '公历',
  }
}
function togetherLabel(start, selected) {
  if (!start) return '从哪一天开始？'
  const dayNumber = (value) => {
    const [y, m, d] = value.split('-').map(Number)
    return Date.UTC(y, m - 1, d) / 86400000
  }
  const elapsed = dayNumber(selected) - dayNumber(start)
  return elapsed >= 0 ? `在一起第 ${elapsed + 1} 天` : `距离在一起还有 ${-elapsed} 天`
}
function requireCouple() {
  const u = wx.getStorageSync('user')
  if (!u?.coupleId) {
    wx.navigateTo({ url: '/pages/couple/couple' })
    return false
  }
  return true
}
module.exports = { date, event, requireCouple, togetherLabel }
