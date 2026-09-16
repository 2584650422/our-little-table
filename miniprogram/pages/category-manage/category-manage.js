const api=require('../../services/dishes')
Page({
  data:{categories:[],editingId:null,form:{name:'',icon:'🍽️',sortOrder:0},loading:true,draggingId:null,shiftingId:null},
  onShow(){this.load()},
  async load(){try{this.setData({categories:await api.categories(),loading:false})}catch(e){wx.showToast({title:e.message,icon:'none'});this.setData({loading:false})}},
  add(){this.setData({editingId:0,form:{name:'',icon:'🍽️',sortOrder:(this.data.categories.length+1)*10}})},
  edit(e){if(this._ignoreTap)return;const item=this.data.categories.find(category=>String(category.id)===String(e.currentTarget.dataset.id));this.setData({editingId:item.id,form:{name:item.name,icon:item.icon||'🍽️',sortOrder:item.sortOrder}})},
  input(e){this.setData({[`form.${e.currentTarget.dataset.key}`]:e.detail.value})},
  cancel(){this.setData({editingId:null})},
  async save(){const data=this.data.form;if(!String(data.name).trim())return wx.showToast({title:'给分类起个名字吧',icon:'none'});try{this.data.editingId?await api.updateCategory(this.data.editingId,data):await api.createCategory(data);this.setData({editingId:null});await this.load();wx.showToast({title:'分类保存好啦',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'})}},
  async remove(e){const item=this.data.categories.find(category=>String(category.id)===String(e.currentTarget.dataset.id));const result=await new Promise(resolve=>wx.showModal({title:`删除“${item.name}”？`,content:'分类中还有菜时不能删除，可以先把菜移动到其他分类。',confirmColor:'#E86F94',success:resolve}));if(!result.confirm)return;try{await api.deleteCategory(item.id);await this.load()}catch(error){wx.showToast({title:error.message,icon:'none'})}}
  ,dragStart(e){this._dragging=true;this._dragStartY=e.touches?.[0]?.clientY||e.changedTouches?.[0]?.clientY||0;this.setData({draggingId:e.currentTarget.dataset.id,shiftingId:null});wx.vibrateShort?.({type:'light'})},
  dragMove(e){if(!this._dragging)return;const y=e.touches?.[0]?.clientY;if(typeof y!=='number'||Math.abs(y-this._dragStartY)<44)return;const current=this.data.categories.findIndex(item=>String(item.id)===String(this.data.draggingId)),direction=y>this._dragStartY?1:-1,target=Math.max(0,Math.min(this.data.categories.length-1,current+direction));if(target===current)return;const categories=this.data.categories.slice(),[moving]=categories.splice(current,1);categories.splice(target,0,moving);this._dragStartY=y;this.setData({categories,shiftingId:categories[current]?.id||null});wx.vibrateShort?.({type:'light'});clearTimeout(this._shiftTimer);this._shiftTimer=setTimeout(()=>this.setData({shiftingId:null}),220)},
  async dragEnd(){if(!this._dragging)return;this._dragging=false;this._ignoreTap=true;setTimeout(()=>this._ignoreTap=false,180);this.setData({draggingId:null,shiftingId:null});try{await api.reorderCategories(this.data.categories.map(item=>item.id));wx.showToast({title:'分类顺序已保存',icon:'none'})}catch(e){wx.showToast({title:e.message,icon:'none'});this.load()}}
})
