const {request}=require('../../services/api')
const subscribe=require('../../services/notifications')
Page({
  data:{items:[],unreadCount:0,loading:true,error:'',configured:false,templateHint:'',creditHint:''},
  onShow(){this.load()},
  async load(){
    this.setData({loading:true,error:''})
    try{
      await getApp().loginPromise
      const [notifications,config]=await Promise.all([request({url:'/api/notifications'}),subscribe.loadConfig()])
      this._templateIds=[config.orderTemplateId,config.servedTemplateId].filter((id,index,array)=>id&&array.indexOf(id)===index)
      const configured=this._templateIds.length>0
      const credits=notifications.subscriptionCredits||{}
      this.setData({items:notifications.items||[],unreadCount:notifications.unreadCount||0,configured,templateHint:configured?'提交、查看未上菜菜单或上菜时，会顺便申请提醒机会':'微信订阅消息暂未配置，站内消息照常可用',creditHint:configured?`预计可用：点菜提醒 ${credits.created||0} 次 · 做饭完成 ${credits.served||0} 次`:'',loading:false})
    }catch(error){this.setData({loading:false,error:error.message||'消息暂时没打开'})}
  },
  async subscribe(){
    if(!this._templateIds||!this._templateIds.length)return wx.showToast({title:'微信提醒暂未配置',icon:'none'})
    const result=await subscribe.authorizeAtAction()
    wx.showToast({title:result.accepted?`已增加 ${result.accepted} 类提醒机会`:'没有新增提醒机会',icon:'none'})
    this.load()
  },
  async markRead(){
    try{await request({url:'/api/notifications/read',method:'PUT'});this.setData({unreadCount:0,items:this.data.items.map(item=>({...item,readAt:item.readAt||'已读'}))})}
    catch(error){wx.showToast({title:error.message||'稍后再试',icon:'none'})}
  },
  openOrder(event){wx.navigateTo({url:`/pages/order-detail/order-detail?id=${event.currentTarget.dataset.id}`})}
})
