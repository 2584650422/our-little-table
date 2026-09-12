const {request}=require('../../services/api'),cart=require('../../utils/cart'),upload=require('../../services/upload'),homeCopy=require('../../utils/home-copy')
Page({
  data:{couple:null,name:'',anniversary:'',homeTitle:'',homeSubtitle:'',nickname:'',avatarUrl:'',currentUserId:null,loading:true,uploadingAvatar:false},
  onLoad(options){this._focus=options.focus;this.load()},
  async load(){
    try{
      const couple=await request({url:'/api/couples/current'}),user=wx.getStorageSync('user')||{}
      this.setData({couple,name:couple.name,anniversary:couple.anniversary||'',homeTitle:couple.homeTitle||'今天想吃点什么呀？',homeSubtitle:couple.homeSubtitle||'认真选一顿，也是在认真过日子。',nickname:user.nickname||'',avatarUrl:user.avatarUrl||'',currentUserId:user.id,loading:false})
      if(this._focus==='members'){this._focus='';setTimeout(()=>wx.pageScrollTo({selector:'#members',duration:250}),100)}
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value})},
  date(e){this.setData({anniversary:e.detail.value})},
  async chooseAvatar(){
    try{
      const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}))
      this.setData({uploadingAvatar:true})
      const image=await upload.uploadImage(result.tempFiles[0].tempFilePath,'avatar')
      this.setData({avatarUrl:image.imageUrl})
      wx.showToast({title:'头像选好啦，记得保存',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'头像选择失败',icon:'none'})}
    finally{this.setData({uploadingAvatar:false})}
  },
  removeAvatar(){this.setData({avatarUrl:''})},
  async save(){
    const oldUser=wx.getStorageSync('user')||{}
    try{
      const updatedCouple=await request({url:'/api/couples/current',method:'PUT',data:{name:this.data.name,anniversary:this.data.anniversary||null,homeTitle:this.data.homeTitle,homeSubtitle:this.data.homeSubtitle},loading:true})
      const copy=homeCopy.save(updatedCouple)
      const homePage=getCurrentPages().find(page=>page.route==='pages/home/home')
      if(homePage)homePage.setData({homeTitle:copy.title,homeSubtitle:copy.subtitle})
      if(this.data.nickname.trim()!==String(oldUser.nickname||'')||this.data.avatarUrl!==String(oldUser.avatarUrl||'')){
        const user=await request({url:'/api/auth/me',method:'PUT',data:{nickname:this.data.nickname,avatarUrl:this.data.avatarUrl||null}})
        wx.setStorageSync('user',user);getApp().globalData.user=user
      }
      wx.showToast({title:'小饭桌更新好啦',icon:'none'});this.load()
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  copy(){wx.setClipboardData({data:this.data.couple.inviteCode})},
  async invite(){try{const result=await request({url:'/api/couples/invite',method:'POST',loading:true});this.setData({'couple.inviteCode':result.inviteCode});wx.showToast({title:'新邀请码准备好啦',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async leave(){const last=this.data.couple.members.length===1;const result=await new Promise(resolve=>wx.showModal({title:'确定离开小饭桌？',content:last?'你是最后一位成员，离开后菜单和记录会一起删除。':'离开后你将看不到这里的菜单和历史，对方的数据会保留。',confirmText:'确认离开',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await request({url:'/api/couples/leave',method:'POST',loading:true});const user=wx.getStorageSync('user')||{};user.coupleId=null;wx.setStorageSync('user',user);getApp().globalData.user=user;cart.clear();homeCopy.clear();wx.showToast({title:'已经离开小饭桌',icon:'none'});setTimeout(()=>wx.switchTab({url:'/pages/settings/settings'}),500)}catch(e){wx.showToast({title:e.message,icon:'none'})}}
})
