const {request}=require('./api')

let templateConfig=null
let authorizationInFlight=null

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
            resolve({accepted:accepted.length})
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

function updateCredits(subscriptionCredits){
  if(templateConfig)templateConfig={...templateConfig,subscriptionCredits:subscriptionCredits||{}}
}

module.exports={loadConfig,warmConfig,authorizeAtAction,updateCredits}
