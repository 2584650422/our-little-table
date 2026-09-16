const {request}=require('../../services/api'),cart=require('../../utils/cart'),upload=require('../../services/upload'),homeCopy=require('../../utils/home-copy')
Page({
  data:{couple:null,name:'',anniversary:'',homeTitle:'',homeSubtitle:'',nickname:'',avatarUrl:'',avatarImageKey:'',currentUserId:null,loading:true,uploadingAvatar:false,uploadStage:''},
  onLoad(options){this._focus=options.focus;this.load()},
  async load(){
    try{
      const couple=await request({url:'/api/couples/current'}),user=wx.getStorageSync('user')||{}
      this.setData({couple,name:couple.name,anniversary:couple.anniversary||'',homeTitle:couple.homeTitle||'今天想吃点什么呀？',homeSubtitle:couple.homeSubtitle||'认真选一顿，也是在认真过日子。',nickname:user.nickname||'',avatarUrl:user.avatarUrl||'',avatarImageKey:user.avatarKey||'',currentUserId:user.id,loading:false})
      if(this._focus==='members'){this._focus='';setTimeout(()=>wx.pageScrollTo({selector:'#members',duration:250}),100)}
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value})},
  date(e){this.setData({anniversary:e.detail.value})},
  async chooseAvatar(){
    try{
      const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}))
      this.setData({uploadingAvatar:true})
      const image=await upload.uploadImage(result.tempFiles[0].tempFilePath,'avatar',stage=>this.setData({uploadStage:stage}))
      this.setData({avatarUrl:image.imageUrl,avatarImageKey:image.imageKey})
      wx.showToast({title:'头像选好啦，记得保存',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'头像选择失败',icon:'none'})}
    finally{this.setData({uploadingAvatar:false,uploadStage:''})}
  },
  removeAvatar(){this.setData({avatarUrl:'',avatarImageKey:''})},
  async save(){
    const oldUser=wx.getStorageSync('user')||{}
    try{
      const updatedCouple=await request({url:'/api/couples/current',method:'PUT',data:{name:this.data.name,anniversary:this.data.anniversary||null,homeTitle:this.data.homeTitle,homeSubtitle:this.data.homeSubtitle},loading:true})
      const copy=homeCopy.save(updatedCouple)
      const homePage=getCurrentPages().find(page=>page.route==='pages/home/home')
      if(homePage)homePage.setData({homeTitle:copy.title,homeSubtitle:copy.subtitle})
      if(this.data.nickname.trim()!==String(oldUser.nickname||'')||this.data.avatarImageKey!==String(oldUser.avatarKey||'')||this.data.avatarUrl!==String(oldUser.avatarUrl||'')){
        const user=await request({url:'/api/auth/me',method:'PUT',data:{nickname:this.data.nickname,avatarImageKey:this.data.avatarImageKey||null,avatarUrl:this.data.avatarUrl||null}})
        wx.setStorageSync('user',user);getApp().globalData.user=user
      }
      wx.showToast({title:'小饭桌更新好啦',icon:'none'});this.load()
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  copy(){wx.setClipboardData({data:this.data.couple.inviteCode})},
  async invite(){try{const result=await request({url:'/api/couples/invite',method:'POST',loading:true});this.setData({'couple.inviteCode':result.inviteCode});wx.showToast({title:'新邀请码准备好啦',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async leave(){const result=await new Promise(resolve=>wx.showModal({title:'确定离开小饭桌？',content:'离开后不再显示这张饭桌，但它和历史记录不会被删除。',confirmText:'确认离开',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await request({url:'/api/couples/leave',method:'POST',loading:true});const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;cart.clear();homeCopy.clear();wx.showToast({title:'已经离开小饭桌',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/settings/settings'}),500)}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async deleteCouple(){const result=await new Promise(resolve=>wx.showModal({title:'删除整张小饭桌？',content:'菜单、订单、照片和饭饭记录都会永久删除，无法恢复。仅创建者且没有其他成员时可执行。',confirmText:'永久删除',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await request({url:'/api/couples/current',method:'DELETE',loading:true});const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;cart.clear();homeCopy.clear();wx.showToast({title:'小饭桌已删除',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/settings/settings'}),500)}catch(e){wx.showToast({title:e.message,icon:'none'})}}
})
