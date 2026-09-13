const {request}=require('../../services/api'),cart=require('../../utils/cart'),homeCopy=require('../../utils/home-copy')
Page({
  data:{mode:'create',name:'我们的小饭桌',inviteCode:'',nickname:'',created:null,couples:[],loading:true},
  onShow(){this.load()},
  async load(){try{await getApp().loginPromise;const user=wx.getStorageSync('user')||{},couples=await request({url:'/api/couples/mine'});this.setData({nickname:user.nickname==='新朋友'?'':user.nickname||'',couples,loading:false})}catch(e){this.setData({loading:false});wx.showToast({title:e.message,icon:'none'})}},
  mode(e){this.setData({mode:e.currentTarget.dataset.mode})},
  input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value})},
  async saveNickname(){if(!this.data.nickname.trim())return;const user=await request({url:'/api/auth/me',method:'PUT',data:{nickname:this.data.nickname.trim()}});wx.setStorageSync('user',user);getApp().globalData.user=user},
  async submit(){try{await this.saveNickname();if(this.data.mode==='create'){const created=await request({url:'/api/couples',method:'POST',data:{name:this.data.name},loading:true});cart.clear();homeCopy.clear();this.setData({created});const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;this.load()}else{await request({url:'/api/couples/join',method:'POST',data:{inviteCode:this.data.inviteCode},loading:true});cart.clear();homeCopy.clear();const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;wx.showToast({title:'坐到一起啦',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/home/home'}),500)}}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async switchCouple(e){try{await request({url:`/api/couples/switch/${e.currentTarget.dataset.id}`,method:'POST',loading:true});cart.clear();homeCopy.clear();const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;wx.showToast({title:'已经切换小饭桌',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/home/home'}),450)}catch(err){wx.showToast({title:err.message,icon:'none'})}},
  copy(){wx.setClipboardData({data:this.data.created.inviteCode})},
  home(){wx.switchTab({url:'/pages/home/home'})}
})
