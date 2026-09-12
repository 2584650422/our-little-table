const {request}=require('../../services/api'),config=require('../../config/index')
Page({
  data:{couple:null,user:null,loading:true,error:''},
  onShow(){this.load()},
  async load(){try{await getApp().loginPromise;const user=wx.getStorageSync('user');if(!user?.coupleId){this.setData({user,loading:false,couple:null});return}const couple=await request({url:'/api/couples/current'});this.setData({user,couple,loading:false,error:''})}catch(e){this.setData({error:e.message,loading:false})}},
  couple(){wx.navigateTo({url:'/pages/couple/couple'})},
  favorites(){wx.navigateTo({url:'/pages/favorites/favorites'})},
  manage(){wx.navigateTo({url:'/pages/dish-manage/dish-manage'})},
  coupleSettings(){wx.navigateTo({url:'/pages/couple-settings/couple-settings'})},
  meals(){wx.setStorageSync('orders_open_tab','history');wx.switchTab({url:'/pages/orders/orders'})},
  members(){wx.navigateTo({url:'/pages/couple-settings/couple-settings?focus=members'})},
  async subscribe(){if(!config.wechatOrderTemplateId)return wx.showToast({title:'请先填写订阅消息 Template ID',icon:'none'});try{await wx.requestSubscribeMessage({tmplIds:[config.wechatOrderTemplateId]});wx.showToast({title:'点菜提醒开启啦',icon:'none'})}catch(_){wx.showToast({title:'这次没有开启，也没关系',icon:'none'})}}
})
