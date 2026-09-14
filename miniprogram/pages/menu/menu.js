const api=require('../../services/dishes'),cart=require('../../utils/cart')

Page({
  data:{categories:[],dishes:[],categoryId:'',keyword:'',loading:true,error:'',cartCount:0,activeCategoryName:'全部菜品',selectedItems:[],selectedExpanded:false},
  onShow(){this.load()},
  async load(){
    this.setData({loading:true,error:''})
    try{
      await getApp().loginPromise
      const user=wx.getStorageSync('user')
      if(!user?.coupleId){wx.navigateTo({url:'/pages/couple/couple'});this.setData({loading:false});return}
      const [categories,dishes]=await Promise.all([api.categories(),api.list({})])
      this._allDishes=dishes
      this.refreshCartState(categories)
      this.applyFilters(categories)
      this.setData({loading:false})
    }catch(e){this.setData({error:e.message,loading:false})}
  },
  refreshCartState(sourceCategories){
    const list=cart.get(),all=this._allDishes||[],counts={}
    list.forEach(item=>{
      const dish=all.find(row=>String(row.id)===String(item.dishId)),categoryId=item.categoryId||(dish&&dish.categoryId)
      if(categoryId)counts[String(categoryId)]=(counts[String(categoryId)]||0)+item.quantity
    })
    const categories=(sourceCategories||this.data.categories).map(item=>({...item,cartCount:counts[String(item.id)]||0}))
    this.setData({categories,cartCount:list.reduce((sum,item)=>sum+item.quantity,0),selectedItems:list})
  },
  applyFilters(sourceCategories){
    const keyword=this.data.keyword.trim().toLowerCase(),categoryId=String(this.data.categoryId||'')
    const dishes=(this._allDishes||[]).filter(item=>(!categoryId||String(item.categoryId)===categoryId)&&(!keyword||item.name.toLowerCase().includes(keyword)||(item.description||'').toLowerCase().includes(keyword)))
    const categories=sourceCategories||this.data.categories,active=categories.find(item=>String(item.id)===categoryId)
    this.setData({dishes,activeCategoryName:active?`${active.icon||''} ${active.name}`:'全部菜品'})
  },
  chooseCategory(e){this.setData({categoryId:e.currentTarget.dataset.id||''},()=>this.applyFilters())},
  input(e){this.setData({keyword:e.detail.value})},
  search(){this.applyFilters()},
  detail(e){wx.navigateTo({url:`/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}`})},
  add(e){
    const id=e.currentTarget.dataset.id,dish=(this._allDishes||[]).find(item=>String(item.id)===String(id))
    if(!dish)return
    cart.add(dish);this.refreshCartState();wx.showToast({title:'已经放进小菜单啦',icon:'none'})
  },
  async favorite(e){
    const id=e.currentTarget.dataset.id,dish=(this._allDishes||[]).find(item=>String(item.id)===String(id))
    try{
      await api.favorite(id,!dish.isFavorite)
      this._allDishes=this._allDishes.map(item=>String(item.id)===String(id)?{...item,isFavorite:!item.isFavorite}:item)
      this.applyFilters();wx.showToast({title:!dish.isFavorite?'收藏好啦 ❤️':'已取消收藏',icon:'none'})
    }catch(err){wx.showToast({title:err.message,icon:'none'})}
  },
  toggleSelected(){this.setData({selectedExpanded:!this.data.selectedExpanded})},
  goCart(){this.setData({selectedExpanded:false});wx.navigateTo({url:'/pages/cart/cart'})},
  changeQuantity(e){
    const dishId=String(e.currentTarget.dataset.id),delta=Number(e.currentTarget.dataset.delta)
    const list=cart.get().map(item=>String(item.dishId)===dishId?{...item,quantity:Math.max(0,item.quantity+delta)}:item).filter(item=>item.quantity>0)
    cart.save(list);this.refreshCartState()
  },
  removeSelected(e){
    const dishId=String(e.currentTarget.dataset.id)
    cart.save(cart.get().filter(item=>String(item.dishId)!==dishId));this.refreshCartState()
  },
  async clearSelected(){
    if(!this.data.cartCount)return
    const result=await new Promise(resolve=>wx.showModal({title:'清空已选菜品？',content:'这次加入的小菜单会全部移除。',confirmText:'清空',confirmColor:'#C45F7D',success:resolve}))
    if(!result.confirm)return
    cart.clear();this.refreshCartState();this.setData({selectedExpanded:false});wx.showToast({title:'已清空小菜单',icon:'none'})
  }
})
