const {request}=require('../../services/api'),dishesApi=require('../../services/dishes'),layout=require('../../utils/layout')
const updates=require('../../services/updates')
Page({
  data:{topInset:layout.topInset(),couple:null,user:null,profileMe:null,profilePartnerAvatarUrl:'',profilePartnerInitial:'?',favoriteCount:0,unreadCount:0,coupleSubtitle:'',loading:true,error:'',versionInfo:updates.snapshot()},
  onShow(){this.stopVersionListener();this._stopVersionListener=updates.subscribe(versionInfo=>this.setData({versionInfo}));this.load()},
  onHide(){this.stopVersionListener()},
  onUnload(){this.stopVersionListener()},
  stopVersionListener(){if(this._stopVersionListener){this._stopVersionListener();this._stopVersionListener=null}},
  versionUpdate(){updates.open()},
  async load(){
    this.setData({loading:true,error:''})
    try{
      await getApp().loginPromise
      const user=wx.getStorageSync('user')||{}
      if(!user.coupleId){this.setData({user,loading:false,couple:null});return}
      const couple=await request({url:'/api/couples/current'})
      const members=Array.isArray(couple.members)?couple.members:[]
      const me=members.find(member=>String(member.id)===String(user.id))||user
      const partner=members.find(member=>String(member.id)!==String(user.id))||null
      const profileMe={...me,initial:String(me.nickname||'饭').trim().charAt(0)||'饭'}
      const profilePartnerAvatarUrl=partner&&partner.avatarUrl||''
      const profilePartnerInitial=partner?(String(partner.nickname||'饭').trim().charAt(0)||'饭'):'?'
      let favoriteCount=0
      try{favoriteCount=(await dishesApi.list({favorite:'true'})).length}catch(_){}
      let unreadCount=0
      try{unreadCount=(await request({url:'/api/notifications'})).unreadCount||0}catch(_){}
      this.setData({user,couple,profileMe,profilePartnerAvatarUrl,profilePartnerInitial,favoriteCount,unreadCount,coupleSubtitle:'一起吃饭，就是最好的日常',loading:false,error:''})
    }catch(e){this.setData({error:e.message,loading:false})}
  },
  couple(){wx.navigateTo({url:'/pages/couple/couple'})},
  favorites(){wx.navigateTo({url:'/pages/favorites/favorites'})},
  coupleSettings(){wx.navigateTo({url:'/pages/couple-settings/couple-settings'})},
  meals(){wx.setStorageSync('orders_open_tab','history');wx.switchTab({url:'/pages/orders/orders'})},
  about(){wx.showModal({title:'两个人的小饭桌',content:'只为两个人准备的一本私人菜单和吃饭记录。今天想吃什么，就从这里慢慢选。',showCancel:false,confirmText:'知道啦'})},
  notifications(){wx.navigateTo({url:'/pages/notifications/notifications'})}
})
