// 每次上传前更新包标识，用于区分正式版、体验版和本地预览的实际代码。
const BUILD_ID = '2026.09.28.2'
const labels = {
  checking: '等待微信检查更新',
  current: '本次检查暂未发现新版',
  downloading: '新版本正在下载',
  ready: '新版本已就绪，点击更新',
  failed: '更新下载失败，点击重试',
  unsupported: '请重新打开或更新微信'
}
let manager = null
let initialized = false
let visible = false
let modalOpen = false
let failurePrompted = false
let status = 'checking'
const listeners = new Set()

function versionInfo() {
  let info = {}
  try { info = wx.getAccountInfoSync().miniProgram || {} } catch (_) {}
  const channel = { release: '正式版', trial: '体验版', develop: '开发/预览版' }[info.envVersion] || '当前版本'
  return { channel, version: info.version || '', build: BUILD_ID }
}

function snapshot() {
  const info = versionInfo()
  return { ...info, status, hint: labels[status], display: `${info.channel} · ${info.version || info.build}` }
}

function setStatus(next) {
  status = next
  listeners.forEach(listener => listener(snapshot()))
  console.info('[小饭桌更新]', status, versionInfo())
}

function showDialog(options) {
  if (modalOpen) return
  modalOpen = true
  try {
    wx.showModal({
      ...options,
      success: result => {
        modalOpen = false
        if (options.success) options.success(result)
      },
      fail: () => { modalOpen = false }
    })
  } catch (_) { modalOpen = false }
}

function reopenHelp() {
  showDialog({
    title: '请重新打开小饭桌',
    content: '请完全关闭小程序窗口，再从微信重新打开。电脑端如果仍显示旧界面，请退出并重新登录微信后再打开。体验版和预览版请使用最新二维码进入。',
    showCancel: false,
    confirmText: '知道啦'
  })
}

function restart() {
  // 重启交给微信处理；清空 Storage 无法更新代码包，还会丢掉未提交菜单。
  if (typeof wx.restartMiniProgram !== 'function') return reopenHelp()
  try {
    wx.restartMiniProgram({ path: '/pages/settings/settings', fail: reopenHelp })
  } catch (_) { reopenHelp() }
}

function applyUpdate() {
  // 只有收到 onUpdateReady 才能 applyUpdate，下载中不能提前切换包。
  if (status !== 'ready' || !manager) return restart()
  try { manager.applyUpdate() } catch (_) { reopenHelp() }
}

function promptReady() {
  if (!visible || status !== 'ready') return
  showDialog({
    title: '新版本已准备好',
    content: '重新打开即可使用新界面。已保存的登录状态和未提交菜单会保留，请先保存正在编辑的内容。',
    confirmText: '重新打开',
    cancelText: '稍后更新',
    success: result => { if (result.confirm) applyUpdate() }
  })
}

function promptFailure() {
  if (!visible || failurePrompted || status !== 'failed') return
  failurePrompted = true
  showDialog({
    title: '新版本下载失败',
    content: '请检查网络后重新打开，让微信再次检查更新。也可以在“我们 → 版本与更新”查看状态。',
    confirmText: '重新打开',
    cancelText: '稍后再试',
    success: result => {
      if (result.confirm) status === 'ready' ? applyUpdate() : restart()
      else if (status === 'ready') promptReady()
    }
  })
}

function init() {
  if (initialized) return
  initialized = true
  try {
    if (typeof wx.getUpdateManager !== 'function') throw new Error('unsupported')
    manager = wx.getUpdateManager()
    if (!manager || !['onCheckForUpdate', 'onUpdateReady', 'onUpdateFailed', 'applyUpdate'].every(key => typeof manager[key] === 'function')) throw new Error('unsupported')
    // 微信负责检查和下载；重复获取 UpdateManager 或 reLaunch 页面不会主动拉取新包。
    manager.onCheckForUpdate(result => {
      if (status === 'ready') return
      setStatus(result.hasUpdate ? 'downloading' : 'current')
    })
    manager.onUpdateReady(() => {
      setStatus('ready')
      promptReady()
    })
    manager.onUpdateFailed(() => {
      if (status === 'ready') return
      failurePrompted = false
      setStatus('failed')
      promptFailure()
    })
  } catch (_) { setStatus('unsupported') }
}

function onShow() {
  visible = true
  init()
  // 下载完成时可能在后台，或用户曾选“稍后”；重新进入后补上提示。
  promptReady()
  promptFailure()
}

function onHide() { visible = false }

function subscribe(listener) {
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

function open() {
  init()
  if (status === 'ready') return promptReady()
  const info = snapshot()
  if (status === 'downloading') {
    return showDialog({
      title: '新版本正在下载',
      content: `${info.display}\n请保持网络连接，下载完成后会提示重新打开。`,
      showCancel: false,
      confirmText: '知道啦',
      success: () => { if (status === 'ready') promptReady() }
    })
  }
  const channelTip = info.channel === '正式版'
    ? '微信负责检查和下载已正式发布的新包；若界面仍旧，请重新打开后再确认。'
    : '体验版和预览版请从最新二维码进入，不会自动切换为正式版。'
  showDialog({
    title: '版本与更新',
    content: `${info.display}\n代码包：${info.build}\n${info.hint}\n${channelTip}`,
    confirmText: '重新打开',
    cancelText: '暂不',
    success: result => {
      if (result.confirm) status === 'ready' ? applyUpdate() : restart()
      else if (status === 'ready') promptReady()
    }
  })
}

module.exports = { init, onShow, onHide, subscribe, open, snapshot }
