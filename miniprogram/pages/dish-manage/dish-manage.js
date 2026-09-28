const api=require('../../services/dishes')
Page({
  data:{dishes:[],keyword:'',loading:true,error:''},
  onShow(){this.load()},
  sort(list){return list.slice().sort((a,b)=>Number(b.orderedCount||0)-Number(a.orderedCount||0)||String(a.name).localeCompare(String(b.name),'zh-Hans-CN'))},
  apply(){const keyword=this.data.keyword.trim().toLowerCase();this.setData({dishes:this.sort(this._all||[]).filter(item=>!keyword||[item.name,item.description,item.categoryName,...(item.tags||[])].join(' ').toLowerCase().includes(keyword))})},
  async load(){this.setData({loading:true,error:''});try{this._all=await api.list({includeDisabled:true});this.apply();this.setData({loading:false})}catch(e){this.setData({loading:false,error:e.message||'菜单暂时加载不了'})}},
  input(e){this.setData({keyword:e.detail.value},()=>this.apply())},
  clearSearch(){this.setData({keyword:''},()=>this.apply())},
  add(){wx.navigateTo({url:'/pages/dish-edit/dish-edit'})},
  categories(){wx.navigateTo({url:'/pages/category-manage/category-manage'})},
  edit(e){wx.navigateTo({url:`/pages/dish-edit/dish-edit?id=${e.currentTarget.dataset.id}`})},
  async disable(e){const r=await new Promise(resolve=>wx.showModal({title:'把这道菜收起来？',content:'点过次数和历史记录都会保留。',success:resolve}));if(!r.confirm)return;try{await api.disable(e.currentTarget.dataset.id);this.load()}catch(err){wx.showToast({title:err.message,icon:'none'})}}
})
