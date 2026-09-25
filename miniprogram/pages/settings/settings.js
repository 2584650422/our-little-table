const {request}=require('../../services/api'),config=require('../../config/index'),dishesApi=require('../../services/dishes'),layout=require('../../utils/layout')
Page({
  data:{topInset:layout.topInset(),couple:null,user:null,favoriteCount:0,coupleSubtitle:'',loading:true,error:''},
  onShow(){this.load()},
  async load(){this.setData({loading:true,error:''});try{await getApp().loginPromise;const user=wx.getStorageSync('user');if(!user?.coupleId){this.setData({user,loading:false,couple:null});return}const couple=await request({url:'/api/couples/current'});let favoriteCount=0;try{favoriteCount=(await dishesApi.list({favorite:'true'})).length}catch(_){}const coupleSubtitle=couple.anniversary?`从 ${String(couple.anniversary).slice(0,10)} 开始一起吃饭`:'一起吃饭，就是最好的日常';this.setData({user,couple,favoriteCount,coupleSubtitle,loading:false,error:''})}catch(e){this.setData({error:e.message,loading:false})}},
  couple(){wx.navigateTo({url:'/pages/couple/couple'})},
  favorites(){wx.navigateTo({url:'/pages/favorites/favorites'})},
  manage(){wx.navigateTo({url:'/pages/dish-manage/dish-manage'})},
  coupleSettings(){wx.navigateTo({url:'/pages/couple-settings/couple-settings'})},
  meals(){wx.setStorageSync('orders_open_tab','history');wx.switchTab({url:'/pages/orders/orders'})},
  members(){wx.navigateTo({url:'/pages/couple-settings/couple-settings?focus=members'})},
  about(){wx.showModal({title:'两个人的小饭桌',content:'只为两个人准备的一本私人菜单和吃饭记录。今天想吃什么，就从这里慢慢选。',showCancel:false,confirmText:'知道啦'})},
  async subscribe(){if(!config.wechatOrderTemplateId)return wx.showToast({title:'微信提醒暂未配置',icon:'none'});try{const result=await wx.requestSubscribeMessage({tmplIds:[config.wechatOrderTemplateId]});if(result[config.wechatOrderTemplateId]==='accept')wx.showToast({title:'已开启，对方点菜时会提醒你',icon:'none'});else wx.showToast({title:'未开启提醒，也不影响使用',icon:'none'})}catch(_){wx.showToast({title:'未开启提醒，也不影响使用',icon:'none'})}}
})
