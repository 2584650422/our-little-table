const api=require('../../services/orders'),cart=require('../../utils/cart'),fmt=require('../../utils/format')
Page({
  data:{tab:'active',orders:[],loading:true,error:''},
  onShow(){const requested=wx.getStorageSync('orders_open_tab');if(requested){wx.removeStorageSync('orders_open_tab');this.setData({tab:requested})}this.load()},
  choose(e){this.setData({tab:e.currentTarget.dataset.tab});this.load()},
  async load(){this.setData({loading:true,error:''});try{await getApp().loginPromise;const list=await api.list(this.data.tab);list.forEach(o=>{o.mealLabel=fmt.meal[o.mealType];o.dateLabel=fmt.date(o.mealDate)});this.setData({orders:list,loading:false});if(this.data.tab==='active'){const {request}=require('../../services/api');request({url:'/api/notifications/read',method:'PUT'}).then(()=>wx.removeTabBarBadge({index:2})).catch(()=>{})}}catch(e){this.setData({error:e.message,loading:false})}},
  detail(e){wx.navigateTo({url:`/pages/order-detail/order-detail?id=${e.currentTarget.dataset.id}`})},
  async reorder(e){try{const data=await api.reorder(e.currentTarget.dataset.id);data.items.forEach(i=>{if(i.dishId)cart.add({id:i.dishId,name:i.dishName,imageUrl:i.imageUrl,calorieKcal:i.calorieKcal,calorieUnit:i.calorieUnit},i.quantity)});wx.showToast({title:'已经放回小菜单啦',icon:'none'});wx.navigateTo({url:'/pages/cart/cart'})}catch(err){wx.showToast({title:err.message,icon:'none'})}},
  async remove(e){const result=await new Promise(resolve=>wx.showModal({title:'删除这条饭饭记录？',content:'菜品和这顿饭的信息会一起删除，无法恢复。',confirmText:'删除',confirmColor:'#C45F7D',success:resolve}));if(!result.confirm)return;try{await api.remove(e.currentTarget.dataset.id);wx.showToast({title:'记录已删除',icon:'none'});this.load()}catch(err){wx.showToast({title:err.message,icon:'none'})}}
})
