function topInset(){
  try{
    const capsule=wx.getMenuButtonBoundingClientRect()
    if(capsule&&capsule.bottom)return Math.ceil(capsule.bottom+8)
  }catch(_){}
  try{
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync()
    return (info.statusBarHeight||24)+48
  }catch(_){return 72}
}

module.exports={topInset}
