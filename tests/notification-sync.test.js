const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
function runtime(config={}){
  const authorizations=[],authorizationOptions=[]
  let page,next=()=>Promise.resolve({items:[],unreadCount:0}),requests=0,configs=0,id=0
  const timers=new Map(),delays=[]
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/notifications/notifications'),'utf8'),{
    Page:p=>{page=p},getApp:()=>({loginPromise:Promise.resolve()}),wx:{showToast(){}},
    require:name=>name.endsWith('/api')?{request:()=>{requests++;return next()}}:{loadConfig:async()=>{configs++;return config},updateCredits(){},authorizeAtAction:async (events,options)=>{authorizations.push(events);authorizationOptions.push(options);return {accepted:1,addedByEvent:{thought:1}}}},
    setInterval:(fn,ms)=>{delays.push(ms);timers.set(++id,fn);return id},clearInterval:key=>timers.delete(key)
  })
  page.setData=values=>Object.assign(page.data,values)
  return {page,timers,delays,authorizations,authorizationOptions,setNext:fn=>{next=fn},requests:()=>requests,configs:()=>configs,tick:()=>[...timers.values()][0]?.()}
}
test('消息页可见时每 5 秒取得对方已读状态，不重复加载订阅配置或出现加载动画',async()=>{
  const r=runtime();await r.page.onShow()
  assert.deepEqual(r.delays,[5000]);assert.equal(r.configs(),1)
  r.setNext(async()=>({items:[{id:1,readers:[{id:2,readAt:'已读'}]}],unreadCount:0}))
  await r.tick()
  assert.equal(r.page.data.items[0].readers[0].readAt,'已读')
  assert.equal(r.configs(),1);assert.equal(r.page.data.loading,false)
  r.page.onUnload();assert.equal(r.timers.size,0)
})
test('请求未完成不叠加；隐藏页面后忽略迟到结果，返回时立即重取',async()=>{
  const r=runtime();await r.page.onShow()
  let finish;r.setNext(()=>new Promise(resolve=>{finish=resolve}))
  const pending=r.tick();await r.tick();assert.equal(r.requests(),2)
  r.page.onHide();assert.equal(r.timers.size,0)
  finish({items:[{id:9}],unreadCount:9});await pending
  assert.equal(r.page.data.items.length,0)
  r.setNext(async()=>({items:[{id:10}],unreadCount:1}))
  await r.page.onShow();assert.equal(r.page.data.items[0].id,10);assert.equal(r.timers.size,1)
})
test('同步失败保留消息，后续同步能继续更新',async()=>{
  const r=runtime();r.setNext(async()=>({items:[{id:1}],unreadCount:1}));await r.page.onShow()
  r.setNext(async()=>{throw new Error('断网')});await r.tick()
  assert.equal(r.page.data.items[0].id,1);assert.equal(r.page.data.error,'')
  r.setNext(async()=>({items:[{id:1,readAt:'已读'}],unreadCount:0}));await r.tick()
  assert.equal(r.page.data.unreadCount,0);assert.equal(r.page.data.items[0].readAt,'已读')
})
test('完整刷新期间旧轮询结果不能覆盖新结果',async()=>{
  const r=runtime();await r.page.onShow()
  let finish;r.setNext(()=>new Promise(resolve=>{finish=resolve}));const pending=r.tick()
  r.setNext(async()=>({items:[{id:2}],unreadCount:0}));await r.page.load()
  finish({items:[{id:1}],unreadCount:1});await pending
  assert.equal(r.page.data.items[0].id,2)
})
test('初次加载失败后，轮询成功能移除错误提示',async()=>{
  const r=runtime();r.setNext(async()=>{throw new Error('断网')});await r.page.onShow()
  assert.equal(r.page.data.error,'断网')
  r.setNext(async()=>({items:[{id:3}],unreadCount:0}));await r.tick()
  assert.equal(r.page.data.error,'');assert.equal(r.page.data.items[0].id,3)
})

test('想念提醒单独补充只申请 thought，完成后解除按钮占用',async()=>{
  const r=runtime({orderTemplateId:'order',servedTemplateId:'served',thoughtTemplateId:'thought'})
  await r.page.onShow()
  await r.page.subscribe({currentTarget:{dataset:{event:'thought'}}})
  assert.deepEqual(JSON.parse(JSON.stringify(r.authorizations)),[['thought']])
  assert.equal(r.page.data.authorizing,false)
  r.page.onUnload()
})

test('顶部全部补充一次传入三类事件',async()=>{
  const r=runtime({orderTemplateId:'order',servedTemplateId:'served',thoughtTemplateId:'thought'})
  await r.page.onShow()
  await r.page.subscribe({currentTarget:{dataset:{}}})
  assert.deepEqual(JSON.parse(JSON.stringify(r.authorizations)),[['created','served','thought']])
  assert.equal(r.page.data.authorizing,false)
  r.page.onUnload()
})
