const {request}=require('../../services/api'),cart=require('../../utils/cart'),upload=require('../../services/upload'),homeCopy=require('../../utils/home-copy')
function discardStagedAvatar(key){
  if(!key||key===(wx.getStorageSync('user')||{}).avatarKey)return Promise.resolve()
  return request({url:'/api/uploads/discard',method:'POST',data:{key}}).catch(e=>console.warn('[avatar cleanup] failed',e.message))
}
function discardStagedBackground(key,savedKey){
  if(!key||key===savedKey)return Promise.resolve()
  return request({url:'/api/uploads/discard',method:'POST',data:{key}}).catch(e=>console.warn('[background cleanup] failed',e.message))
}
Page({
  data:{couple:null,name:'',anniversary:'',homeTitle:'',homeSubtitle:'',backgroundImageKey:'',backgroundImageUrl:'',nickname:'',avatarUrl:'',avatarImageKey:'',loading:true,error:'',showDanger:false,uploadingAvatar:false,uploadingBackground:false,uploadStage:''},
  onLoad(options){this._focus=options.focus;this.load()},
  onUnload(){this._disposed=true;if(!this._saving){discardStagedAvatar(this.data.avatarImageKey);discardStagedBackground(this.data.backgroundImageKey,this._savedBackgroundKey)}},
  async load(){
    this.setData({loading:true,error:''})
    try{
      const couple=await request({url:'/api/couples/current'}),user=wx.getStorageSync('user')||{}
      this._savedBackgroundKey=couple.backgroundImageKey||''
      this.setData({couple,name:couple.name,anniversary:couple.anniversary||'',homeTitle:couple.homeTitle||homeCopy.defaults.title,homeSubtitle:couple.homeSubtitle||homeCopy.defaults.subtitle,backgroundImageKey:couple.backgroundImageKey||'',backgroundImageUrl:couple.backgroundImageUrl||'',nickname:user.nickname||'',avatarUrl:user.avatarUrl||'',avatarImageKey:user.avatarKey||'',loading:false,error:''})
      if(this._focus==='members'){this._focus='';wx.navigateTo({url:'/pages/couple-members/couple-members'})}
    }catch(e){this.setData({loading:false,error:e.message||'暂时没能打开设置'});wx.showToast({title:e.message||'加载失败',icon:'none'})}
  },
  input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value})},
  date(e){this.setData({anniversary:e.detail.value})},
  viewMembers(){wx.navigateTo({url:'/pages/couple-members/couple-members'})},
  toggleDanger(){this.setData({showDanger:!this.data.showDanger})},
  manageMenu(){wx.navigateTo({url:'/pages/dish-manage/dish-manage'})},
  async chooseAvatar(){
    if(this._choosingAvatar)return
    this._choosingAvatar=true
    try{
      const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}))
      this.setData({uploadingAvatar:true})
      const image=await upload.uploadImage(result.tempFiles[0].tempFilePath,'avatar',stage=>this.setData({uploadStage:stage}))
      if(this._disposed){await discardStagedAvatar(image.imageKey);return}
      const previousKey=this.data.avatarImageKey
      this.setData({avatarUrl:image.imageUrl,avatarImageKey:image.imageKey})
      if(previousKey!==image.imageKey)await discardStagedAvatar(previousKey)
      wx.showToast({title:'头像选好啦，记得保存',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'头像选择失败',icon:'none'})}
    finally{this._choosingAvatar=false;if(!this._disposed)this.setData({uploadingAvatar:false,uploadStage:''})}
  },
  removeAvatar(){const previousKey=this.data.avatarImageKey;this.setData({avatarUrl:'',avatarImageKey:''});discardStagedAvatar(previousKey)},
  async chooseBackground(){
    if(this._choosingBackground)return
    this._choosingBackground=true
    try{
      const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}))
      this.setData({uploadingBackground:true})
      const image=await upload.uploadImage(result.tempFiles[0].tempFilePath,'background',stage=>this.setData({uploadStage:stage}))
      if(this._disposed){await discardStagedBackground(image.imageKey,this._savedBackgroundKey);return}
      const previousKey=this.data.backgroundImageKey
      this.setData({backgroundImageKey:image.imageKey,backgroundImageUrl:image.imageUrl})
      if(previousKey!==image.imageKey)await discardStagedBackground(previousKey,this._savedBackgroundKey)
      wx.showToast({title:'背景选好啦，记得保存',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'背景选择失败',icon:'none'})}
    finally{this._choosingBackground=false;if(!this._disposed)this.setData({uploadingBackground:false,uploadStage:''})}
  },
  removeBackground(){const previousKey=this.data.backgroundImageKey;this.setData({backgroundImageKey:'',backgroundImageUrl:''});discardStagedBackground(previousKey,this._savedBackgroundKey)},
  async save(){
    if(this._choosingAvatar||this._choosingBackground){wx.showToast({title:'等图片上传完成再保存哦',icon:'none'});return}
    if(this._saving)return
    this._saving=true
    const oldUser=wx.getStorageSync('user')||{}
    try{
      const updatedCouple=await request({url:'/api/couples/current',method:'PUT',data:{name:this.data.name,anniversary:this.data.anniversary||null,homeTitle:this.data.homeTitle,homeSubtitle:this.data.homeSubtitle,backgroundImageKey:this.data.backgroundImageKey||null},loading:true})
      this._savedBackgroundKey=updatedCouple.backgroundImageKey||''
      const copy=homeCopy.save(updatedCouple)
      const homePage=getCurrentPages().find(page=>page.route==='pages/home/home')
      if(homePage)homePage.setData({homeTitle:copy.title,homeSubtitle:copy.subtitle})
      if(this.data.nickname.trim()!==String(oldUser.nickname||'')||this.data.avatarImageKey!==String(oldUser.avatarKey||'')||this.data.avatarUrl!==String(oldUser.avatarUrl||'')){
        const user=await request({url:'/api/auth/me',method:'PUT',data:{nickname:this.data.nickname,avatarImageKey:this.data.avatarImageKey||null,avatarUrl:this.data.avatarUrl||null}})
        wx.setStorageSync('user',user);getApp().globalData.user=user
      }
      wx.showToast({title:'小饭桌更新好啦',icon:'none'});this.load()
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
    finally{this._saving=false}
  },
  switchTable(){wx.navigateTo({url:'/pages/couple/couple'})},
  async leave(){const result=await new Promise(resolve=>wx.showModal({title:'确定离开小饭桌？',content:'离开后不再显示这张饭桌，但它和历史记录不会被删除。',confirmText:'确认离开',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await request({url:'/api/couples/leave',method:'POST',loading:true});const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;cart.clear();homeCopy.clear();wx.showToast({title:'已经离开小饭桌',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/settings/settings'}),500)}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async deleteCouple(){const result=await new Promise(resolve=>wx.showModal({title:'删除整张小饭桌？',content:'菜单、订单、照片和饭饭记录都会永久删除，无法恢复。仅创建者且没有其他成员时可执行。',confirmText:'永久删除',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await request({url:'/api/couples/current',method:'DELETE',loading:true});const user=await request({url:'/api/auth/me'});wx.setStorageSync('user',user);getApp().globalData.user=user;cart.clear();homeCopy.clear();wx.showToast({title:'小饭桌已删除',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/settings/settings'}),500)}catch(e){wx.showToast({title:e.message,icon:'none'})}}
})
