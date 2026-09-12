const api=require('../../services/dishes'),cart=require('../../utils/cart')
const POSITION_KEY='menu_cart_position'

Page({
  data:{categories:[],dishes:[],categoryId:'',keyword:'',loading:true,error:'',cartCount:0,activeCategoryName:'全部菜品',cartStyle:''},
  onLoad(){this.initCartPosition()},
  onShow(){this.load()},
  initCartPosition(){
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync()
    const saved=wx.getStorageSync(POSITION_KEY)||{}
    this._window={width:info.windowWidth,height:info.windowHeight}
    this.setCartPosition(Number.isFinite(saved.x)?saved.x:16,Number.isFinite(saved.y)?saved.y:Math.max(110,info.windowHeight-155))
  },
  setCartPosition(x,y){
    const win=this._window||{width:375,height:667}
    const next={x:Math.max(8,Math.min(x,win.width-126)),y:Math.max(92,Math.min(y,win.height-118))}
    this._cartPosition=next
    this.setData({cartStyle:`left:${next.x}px;top:${next.y}px`})
  },
  dragStart(e){
    const touch=e.touches[0],position=this._cartPosition||{x:16,y:300}
    this._drag={touchX:touch.clientX,touchY:touch.clientY,x:position.x,y:position.y,moved:false}
  },
  dragMove(e){
    if(!this._drag)return
    const touch=e.touches[0],dx=touch.clientX-this._drag.touchX,dy=touch.clientY-this._drag.touchY
    if(Math.abs(dx)+Math.abs(dy)>5)this._drag.moved=true
    this.setCartPosition(this._drag.x+dx,this._drag.y+dy)
  },
  dragEnd(){
    if(!this._drag)return
    this._ignoreCartTap=this._drag.moved
    if(this._ignoreCartTap)setTimeout(()=>{this._ignoreCartTap=false},150)
    wx.setStorageSync(POSITION_KEY,this._cartPosition)
    this._drag=null
  },
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
    this.setData({categories,cartCount:list.reduce((sum,item)=>sum+item.quantity,0)})
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
  goCart(){if(this._ignoreCartTap){this._ignoreCartTap=false;return}wx.navigateTo({url:'/pages/cart/cart'})},
  manage(){wx.navigateTo({url:'/pages/dish-manage/dish-manage'})},
  manageCategories(){wx.navigateTo({url:'/pages/category-manage/category-manage'})}
})
