const {request}=require('./api')

let templateConfig=null

async function loadConfig(){
  if(templateConfig)return templateConfig
  templateConfig=await request({url:'/api/notifications/config'})
  return templateConfig
}

function warmConfig(){
  loadConfig().catch(()=>{})
}

async function authorizeAtAction(){
  let config
  try{config=await loadConfig()}catch(error){return {accepted:0}}
  const templates=[config&&config.orderTemplateId,config&&config.servedTemplateId].filter(Boolean)
  if(!templates.length||typeof wx.requestSubscribeMessage!=='function')return Promise.resolve({accepted:0})
  return new Promise(resolve=>{
    try{
      wx.requestSubscribeMessage({
        tmplIds:templates,
        success:async result=>{
          const accepted=templates.filter(id=>['accept','acceptWithAudio'].includes(result[id]))
          if(!accepted.length)return resolve({accepted:0})
          const requestId=`${Date.now()}-${Math.random().toString(36).slice(2,12)}`
          try{
            await request({url:'/api/notifications/subscriptions',method:'POST',data:{requestId,templateIds:accepted}})
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

module.exports={loadConfig,warmConfig,authorizeAtAction}
