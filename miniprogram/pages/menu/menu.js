const api=require('../../services/dishes'),cart=require('../../utils/cart')

Page({
  data:{categories:[],dishes:[],categoryId:'',keyword:'',loading:true,error:'',cartCount:0,activeCategoryName:'全部菜品',selectedItems:[],selectedExpanded:false,selectedSheetMounted:false},
  onShow(){this.closeSelected({immediate:true});this.load()},
  onHide(){this.closeSelected({immediate:true})},
  onUnload(){clearTimeout(this._sheetTimer)},
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
  chooseCategory(e){if(this.foldForInteraction())return;this.setData({categoryId:e.currentTarget.dataset.id||''},()=>this.applyFilters())},
  input(e){this.setData({keyword:e.detail.value})},
  search(){if(this.foldForInteraction())return;this.applyFilters()},
  detail(e){if(this.foldForInteraction())return;wx.navigateTo({url:`/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}`})},
  add(e){
    const id=e.currentTarget.dataset.id,dish=(this._allDishes||[]).find(item=>String(item.id)===String(id))
    if(!dish)return
    this.foldForInteraction()
    cart.add(dish);this.refreshCartState();wx.showToast({title:'已经放进小菜单啦',icon:'none'})
  },
  async favorite(e){
    if(this.foldForInteraction())return
    const id=e.currentTarget.dataset.id,dish=(this._allDishes||[]).find(item=>String(item.id)===String(id))
    try{
      await api.favorite(id,!dish.isFavorite)
      this._allDishes=this._allDishes.map(item=>String(item.id)===String(id)?{...item,isFavorite:!item.isFavorite}:item)
      this.applyFilters();wx.showToast({title:!dish.isFavorite?'收藏好啦 ❤️':'已取消收藏',icon:'none'})
    }catch(err){wx.showToast({title:err.message,icon:'none'})}
  },
  openSelected(){
    if(!this.data.cartCount){wx.showToast({title:'先从菜单里选几样吧',icon:'none'});return}
    clearTimeout(this._sheetTimer)
    this.setData({selectedSheetMounted:true},()=>setTimeout(()=>this.setData({selectedExpanded:true}),16))
  },
  closeSelected(options={}){
    const immediate=Boolean(options.immediate),after=options.after
    clearTimeout(this._sheetTimer)
    if(!this.data.selectedSheetMounted){if(after)after();return}
    this.setData({selectedExpanded:false})
    if(immediate){this.setData({selectedSheetMounted:false});if(after)after();return}
    this._sheetTimer=setTimeout(()=>{this.setData({selectedSheetMounted:false});if(after)after()},220)
  },
  toggleSelected(){if(this.data.selectedExpanded)this.closeSelected();else this.openSelected()},
  foldForInteraction(){if(!this.data.selectedExpanded)return false;this.closeSelected();return true},
  foldOnBackground(){this.foldForInteraction()},
  foldOnInputFocus(){this.foldForInteraction()},
  noop(){},
  goCart(){this.closeSelected({immediate:true,after:()=>wx.navigateTo({url:'/pages/cart/cart'})})},
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
    cart.clear();this.refreshCartState();this.closeSelected();wx.showToast({title:'已清空小菜单',icon:'none'})
  }
})
