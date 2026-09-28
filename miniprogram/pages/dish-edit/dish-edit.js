const api=require('../../services/dishes')
const upload=require('../../services/upload')
const difficultyOptions=[{value:'easy',name:'简单'},{value:'medium',name:'一般'},{value:'hard',name:'认真做'}]
const spicyOptions=['不辣','微辣','有点辣','中辣','很辣','特别辣']
Page({
  data:{id:null,categories:[],categoryIndex:0,difficultyIndex:0,difficultyOptions,spicyOptions,form:{name:'',description:'',imageKey:'',imageUrl:'',calorieKcal:'',calorieUnit:'份',servingNote:'约两人份',cookTimeMinutes:'',difficulty:'easy',spicyLevel:0,tags:'',sortOrder:0},uploading:false},
  async onLoad(q){try{const categories=await api.categories();this.setData({categories});if(q.id){const d=await api.detail(q.id);this._savedImageKey=d.imageKey||'';this.setData({id:q.id,categoryIndex:Math.max(0,categories.findIndex(c=>Number(c.id)===Number(d.categoryId))),difficultyIndex:Math.max(0,difficultyOptions.findIndex(item=>item.value===d.difficulty)),form:{...d,tags:(d.tags||[]).join('、')}})}}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  onUnload(){if(!this._saved&&this._stagedKey)api.discardImage(this._stagedKey).catch(e=>console.warn('[dish staged image cleanup]',e.message))},
  input(e){this.setData({[`form.${e.currentTarget.dataset.key}`]:e.detail.value})},
  category(e){this.setData({categoryIndex:Number(e.detail.value)})},
  difficulty(e){const difficultyIndex=Number(e.detail.value);this.setData({difficultyIndex,'form.difficulty':difficultyOptions[difficultyIndex].value})},
  spicy(e){this.setData({'form.spicyLevel':Number(e.detail.value)})},
  async chooseImage(){
    try{
      const media=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:resolve,fail:reject}))
      this.setData({uploading:true})
      const image=await upload.uploadImage(media.tempFiles[0].tempFilePath,'dish')
      const previous=this._stagedKey
      this._stagedKey=image.imageKey
      this.setData({'form.imageKey':image.imageKey,'form.imageUrl':image.imageUrl})
      if(previous&&previous!==image.imageKey)api.discardImage(previous).catch(e=>console.warn('[dish staged image cleanup]',e.message))
      wx.showToast({title:'图片选好啦，记得保存',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'图片选择失败',icon:'none'})}
    finally{this.setData({uploading:false})}
  },
  async imageAction(){
    if(this.data.uploading)return
    if(!this.data.form.imageKey&&!this.data.form.imageUrl)return this.chooseImage()
    try{
      const action=await new Promise((resolve,reject)=>wx.showActionSheet({itemList:['更换图片','删除图片'],itemColor:'#51464A',success:resolve,fail:reject}))
      if(action.tapIndex===0)return this.chooseImage()
      const confirm=await new Promise(resolve=>wx.showModal({title:'删除菜品图片？',content:'删除后无法恢复；历史订单仍会保留菜名。',confirmText:'删除',confirmColor:'#D8757A',success:resolve}))
      if(!confirm.confirm)return
      if(this._stagedKey){await api.discardImage(this._stagedKey);this._stagedKey=''}
      if(this.data.id&&this._savedImageKey){await api.deleteImage(this.data.id);this._savedImageKey=''}
      this.setData({'form.imageKey':'','form.imageUrl':''})
      wx.showToast({title:'图片已删除',icon:'none'})
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'操作失败',icon:'none'})}
  },
  async save(){
    if(this.data.uploading)return wx.showToast({title:'等图片上传好再保存哦',icon:'none'})
    const f=this.data.form
    if(!String(f.name||'').trim())return wx.showToast({title:'先给菜起个名字吧',icon:'none'})
    if(!this.data.categories.length)return wx.showToast({title:'请先创建一个分类',icon:'none'})
    const data={...f,categoryId:this.data.categories[this.data.categoryIndex]?.id,tags:String(f.tags||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean)}
    try{this.data.id?await api.update(this.data.id,data):await api.create(data);this._saved=true;this._stagedKey='';wx.showToast({title:'菜单更新好啦',icon:'none'});setTimeout(()=>wx.navigateBack(),450)}catch(e){wx.showToast({title:e.message,icon:'none'})}
  }
})
