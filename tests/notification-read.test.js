const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm')
function runtime(detail){
  let page;const reads=[]
  const services={
    '../../services/api':{request:async options=>{reads.push(options)}},
    '../../services/orders':{detail},
    '../../utils/format':{meal:{dinner:'晚餐'},date:x=>x,dateTime:x=>x}
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/order-detail/order-detail'),'utf8'),{
    Page:p=>{page=p},require:name=>services[name]||{},wx:{showToast(){}},console
  })
  page.setData=values=>Object.assign(page.data,values)
  page.data.id=7
  return {page,reads}
}
test('详情显示成功才提交这次获得的消息编号，不发送全部已读',async()=>{
  const r=runtime(async()=>({mealType:'dinner',status:'pending',unreadNotificationIds:[3,4]}))
  await r.page.load()
  assert.equal(r.page.data.loading,false)
  assert.equal(r.reads.length,1)
  assert.equal(JSON.stringify(r.reads[0].data),JSON.stringify({ids:[3,4]}))
})
test('详情加载失败，不把消息误标为已读',async()=>{
  const r=runtime(async()=>{throw new Error('加载失败')})
  await r.page.load()
  assert.equal(r.page.data.error,'加载失败')
  assert.equal(r.reads.length,0)
})
test('兼容旧后端，详情没有未读编号时仍能显示且不发送全部已读',async()=>{
  const r=runtime(async()=>({mealType:'dinner',status:'ready'}))
  await r.page.load()
  assert.equal(r.page.data.order.isRecorded,true)
  assert.equal(r.reads.length,0)
})
