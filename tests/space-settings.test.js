const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function setup(file, services = {}) {
  let definition
  const user = { id: 1, coupleId: 7, nickname: '小林', avatarKey: '', avatarUrl: '' }
  const app = { loginPromise: Promise.resolve(), globalData: { user } }
  const wx = { getStorageSync: () => user, setStorageSync: (_, value) => Object.assign(user, value), showToast() {}, navigateBack() {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => definition = value, wx, getApp: () => app, setTimeout, console, require: path => {
    if (services[path]) return services[path]
    if (path.endsWith('utils/cart')) return { clear() {} }
    if (path.endsWith('utils/layout')) return { topInset: () => 0 }
    if (path.endsWith('services/upload')) return {}
    if (path.endsWith('utils/life')) return { date: () => '2026-11-05' }
    throw Error('Unexpected dependency '+path)
  } })
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values) } }
  return { page, user, app }
}

const settingsFile = 'miniprogram/pages/couple-settings/couple-settings.js'
function settings(request) {
  const state = setup(settingsFile, { '../../services/api': { request } })
  state.page._savedName = '我们的时光'
  state.page._savedUser = { ...state.user }
  Object.assign(state.page.data, { name: '我们的时光', nickname: '小林', couple: { name: '我们的时光' } })
  return state
}

test('只修改昵称不提交空间、日期或封面', async () => {
  const requests=[]
  const {page,user}=settings(async options => { requests.push(options);return {...user,nickname:options.data.nickname} })
  page.data.nickname='小林的新昵称'
  await page.save()
  assert.equal(requests.length,1)
  assert.equal(requests[0].url,'/api/auth/me')
  assert.equal(user.nickname,'小林的新昵称')
  assert.equal(requests[0].data.anniversary,undefined)
})

test('仅修改空间名称使用独立接口，不发送隐藏字段', async () => {
  const requests=[]
  const {page}=settings(async options => {requests.push(options);return {name:options.data.name}})
  Object.assign(page.data,{name:'新空间名称',anniversary:'旧日期',backgroundImageKey:'旧封面',homeTitle:'旧推荐标题'})
  await page.save()
  assert.equal(requests.length,1)
  assert.equal(requests[0].url,'/api/couples/current/name')
  assert.deepEqual(Object.keys(requests[0].data),['name'])
})

test('名称已保存但资料失败，重试只保存未完成的个人资料', async () => {
  let fail=true;const requests=[]
  const {page,user}=settings(async options => {requests.push(options.url);if(options.url.endsWith('/name'))return {};if(fail)throw Error('网络中断');return {...user,nickname:options.data.nickname}})
  Object.assign(page.data,{name:'新名称',nickname:'新昵称'})
  await page.save();assert.match(page.data.error,/空间名称已保存/)
  fail=false;await page.save()
  assert.equal(requests.filter(url=>url.endsWith('/name')).length,1)
  assert.equal(page.data.error,'')
  assert.equal(page.data.saving,false)
})

test('首页编辑只保存标语和日期，不覆盖空间名称', async () => {
  let saved
  const {page}=setup('miniprogram/pages/home-edit/home-edit.js',{ '../../services/api':{},'../../services/life':{ saveHome:async data=>{saved=data} } })
  Object.assign(page.data,{name:'加载时的旧名称',tagline:'新的首页标语',anniversary:'2026-04-30'})
  await page.save()
  assert.equal(saved.name,undefined)
  assert.equal(saved.tagline,'新的首页标语')
  assert.equal(saved.anniversary,'2026-04-30')
})

test('帮我选菜保留推荐功能，不再请求旧推荐页设置', async () => {
  let recommendations=0
  const {page}=setup('miniprogram/pages/food/food.js',{ '../../services/dishes':{ recommend:async ()=>{recommendations++;return [{id:4,name:'番茄炒蛋'}]} } })
  await page.bootstrap()
  assert.equal(recommendations,1)
  assert.equal(page.data.recommendations[0].id,4)
  assert.equal(page.data.heading,'今天吃什么？')
  assert.equal(page.data.loading,false)
})

test('永久删除入口只对独自留在空间中的创建者开放', async () => {
  let members = [{id:1},{id:2}]
  const {page,user}=setup(settingsFile,{'../../services/api':{ request:async options=>options.url==='/api/auth/me'?{...user}:{name:'我们的时光',createdBy:1,members} }})
  await page.load();assert.equal(page.data.canDelete,false)
  await page.deleteSpace() // No confirmation modal or destructive request is called.
  members=[{id:1}];await page.load();assert.equal(page.data.canDelete,true)
  members=[{id:2}];await page.load();assert.equal(page.data.canDelete,false)
})
