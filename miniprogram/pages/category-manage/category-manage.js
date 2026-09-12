const api=require('../../services/dishes')
Page({
  data:{categories:[],editingId:null,form:{name:'',icon:'🍽️',sortOrder:0},loading:true},
  onShow(){this.load()},
  async load(){try{this.setData({categories:await api.categories(),loading:false})}catch(e){wx.showToast({title:e.message,icon:'none'});this.setData({loading:false})}},
  add(){this.setData({editingId:0,form:{name:'',icon:'🍽️',sortOrder:(this.data.categories.length+1)*10}})},
  edit(e){const item=this.data.categories.find(category=>String(category.id)===String(e.currentTarget.dataset.id));this.setData({editingId:item.id,form:{name:item.name,icon:item.icon||'🍽️',sortOrder:item.sortOrder}})},
  input(e){this.setData({[`form.${e.currentTarget.dataset.key}`]:e.detail.value})},
  cancel(){this.setData({editingId:null})},
  async save(){const data=this.data.form;if(!String(data.name).trim())return wx.showToast({title:'给分类起个名字吧',icon:'none'});try{this.data.editingId?await api.updateCategory(this.data.editingId,data):await api.createCategory(data);this.setData({editingId:null});await this.load();wx.showToast({title:'分类保存好啦',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async remove(e){const item=this.data.categories.find(category=>String(category.id)===String(e.currentTarget.dataset.id));const result=await new Promise(resolve=>wx.showModal({title:`删除“${item.name}”？`,content:'分类中还有菜时不能删除，可以先把菜移动到其他分类。',confirmColor:'#E86F94',success:resolve}));if(!result.confirm)return;try{await api.deleteCategory(item.id);await this.load()}catch(error){wx.showToast({title:error.message,icon:'none'})}}
})
