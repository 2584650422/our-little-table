const {request}=require('../../services/api')

Page({
  data:{loading:true,error:'',couple:null,members:[],memberCount:0,needsInvite:false,expandedId:''},
  onShow(){this.load()},
  async load(){
    this.setData({loading:true,error:''})
    try{
      await getApp().loginPromise
      const couple=await request({url:'/api/couples/current'})
      const user=wx.getStorageSync('user')||{}
      const members=(couple.members||[]).map(member=>({
        ...member,
        initial:String(member.nickname||'饭').trim().charAt(0)||'饭',
        isSelf:String(member.id)===String(user.id),
        relationText:String(member.id)===String(user.id)?'我':'TA',
        roleText:String(member.id)===String(couple.createdBy)?'饭桌创建者':'饭桌成员'
      }))
      const self=members.find(member=>member.isSelf)
      this.setData({couple,members,memberCount:members.length,needsInvite:members.length<2,expandedId:self?self.id:'',loading:false})
    }catch(e){this.setData({loading:false,error:e.message||'暂时没能看到饭桌成员'})}
  },
  toggleMember(e){
    const id=e.currentTarget.dataset.id
    this.setData({expandedId:String(this.data.expandedId)===String(id)?'':id})
  },
  editMine(){wx.navigateBack({delta:1})},
  copy(){if(this.data.couple&&this.data.couple.inviteCode)wx.setClipboardData({data:this.data.couple.inviteCode})},
  async invite(){
    try{
      await request({url:'/api/couples/invite',method:'POST',loading:true})
      const couple=await request({url:'/api/couples/current'})
      this.setData({'couple.inviteCode':couple.inviteCode,'couple.inviteExpireAt':couple.inviteExpireAt})
      wx.showToast({title:'新邀请码准备好啦',icon:'none'})
    }catch(e){wx.showToast({title:e.message||'生成邀请码失败',icon:'none'})}
  }
})
