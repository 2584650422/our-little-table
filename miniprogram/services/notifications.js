const {request}=require('./api')

let templateConfig=null
let authorizationInFlight=null
const testSendInFlight={}

async function loadConfig(refresh=false){
  if(templateConfig&&!refresh)return templateConfig
  templateConfig=await request({url:'/api/notifications/config'})
  return templateConfig
}

function warmConfig(refresh=true){
  loadConfig(refresh).catch(()=>{})
}

function authorizeAtAction(){
  if(authorizationInFlight)return authorizationInFlight
  authorizationInFlight=authorizeOnce().finally(()=>{authorizationInFlight=null})
  return authorizationInFlight
}

async function authorizeOnce(){
  let config
  try{config=await loadConfig()}catch(error){return {accepted:0}}
  const credits=config.subscriptionCredits||{}
  const max=config.subscriptionCreditMax||10
  const templates=[[config.orderTemplateId,'created'],[config.servedTemplateId,'served']]
    .filter(([id,event])=>id&&(credits[event]||0)<max)
    .map(([id])=>id)
  if(!templates.length)return {accepted:0,capped:true}
  if(typeof wx.requestSubscribeMessage!=='function')return Promise.resolve({accepted:0})
  return new Promise(resolve=>{
    try{
      wx.requestSubscribeMessage({
        tmplIds:templates,
        success:async result=>{
          const accepted=templates.filter(id=>['accept','acceptWithAudio'].includes(result[id]))
          if(!accepted.length)return resolve({accepted:0})
          const requestId=`${Date.now()}-${Math.random().toString(36).slice(2,12)}`
          try{
            const registered=await request({url:'/api/notifications/subscriptions',method:'POST',data:{requestId,templateIds:accepted}})
            templateConfig={...config,subscriptionCredits:registered.subscriptionCredits||config.subscriptionCredits}
            const added=registered.addedCount||0
            resolve({accepted:added,capped:added===0,addedByEvent:registered.addedByEvent||{}})
          }catch(error){
            console.warn('notification subscription grant was not recorded')
            resolve({accepted:0,recordFailed:true})
          }
        },
        fail:()=>resolve({accepted:0})
      })
    }catch(error){resolve({accepted:0})}
  })
}

function requestOneTemplate(templateId){
  if(typeof wx.requestSubscribeMessage!=='function')return Promise.resolve(false)
  return new Promise(resolve=>{
    try{
      wx.requestSubscribeMessage({
        tmplIds:[templateId],
        success:result=>resolve(['accept','acceptWithAudio'].includes(result[templateId])),
        fail:()=>resolve(false)
      })
    }catch(error){resolve(false)}
  })
}

async function testSend(event){
  if(testSendInFlight[event])return testSendInFlight[event]
  testSendInFlight[event]=(async()=>{
    const config=await loadConfig()
    const templateId=event==='created'?config.orderTemplateId:event==='served'?config.servedTemplateId:''
    if(!templateId)return {sent:false,reason:'微信提醒模板暂未配置'}
    const max=config.subscriptionCreditMax||10
    let credits=config.subscriptionCredits||{}
    if((credits[event]||0)<1){
      const accepted=await requestOneTemplate(templateId)
      if(!accepted)return {sent:false,reason:'没有获得该提醒模板的授权'}
      const requestId=`${Date.now()}-${Math.random().toString(36).slice(2,12)}`
      const registered=await request({url:'/api/notifications/subscriptions',method:'POST',data:{requestId,templateIds:[templateId]}})
      credits=registered.subscriptionCredits||credits
      templateConfig={...config,subscriptionCredits:credits}
      if((credits[event]||0)<1)return {sent:false,capped:true,reason:`该提醒机会已达到${max}次上限`}
    }
    const result=await request({url:'/api/notifications/test-send',method:'POST',data:{event}})
    templateConfig={...config,subscriptionCredits:result.subscriptionCredits||credits}
    return result
  })().finally(()=>{delete testSendInFlight[event]})
  return testSendInFlight[event]
}

function updateCredits(subscriptionCredits){
  if(templateConfig)templateConfig={...templateConfig,subscriptionCredits:subscriptionCredits||{}}
}

module.exports={loadConfig,warmConfig,authorizeAtAction,testSend,updateCredits}
