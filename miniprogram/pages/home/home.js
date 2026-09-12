const dishesApi=require('../../services/dishes')
const ordersApi=require('../../services/orders')
const {request}=require('../../services/api')
const cart=require('../../utils/cart')
const fmt=require('../../utils/format')
const homeCopy=require('../../utils/home-copy')

Page({
  data:{
    dateText:'',greeting:'',homeTitle:homeCopy.defaults.title,
    homeSubtitle:homeCopy.defaults.subtitle,recommendations:[],recent:null,
    loading:true,error:'',needsCouple:false
  },
  onShow(){this.bootstrap()},
  async bootstrap(){
    const now=new Date(),h=now.getHours()
    const cachedCopy=homeCopy.get()
    this.setData({
      dateText:`${now.getMonth()+1} 月 ${now.getDate()} 日 · ${['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][now.getDay()]}`,
      greeting:h<11?'早上好':h<17?'下午好':'晚上好',
      homeTitle:cachedCopy.title,homeSubtitle:cachedCopy.subtitle,loading:true,error:''
    })
    try{
      await getApp().loginPromise
      const user=wx.getStorageSync('user')
      if(!user?.coupleId){homeCopy.clear();this.setData({needsCouple:true,loading:false});return}
      const [couple,recommendations,orders]=await Promise.all([
        request({url:'/api/couples/current'}),dishesApi.recommend(2),ordersApi.list('all')
      ])
      const recent=orders[0]||null
      if(recent){recent.mealLabel=fmt.meal[recent.mealType]||recent.mealType}
      const savedCopy=homeCopy.save(couple)
      this.setData({
        homeTitle:savedCopy.title,homeSubtitle:savedCopy.subtitle,
        recommendations,recent,needsCouple:false,loading:false
      })
    }catch(e){this.setData({error:e.message||'网络好像开小差了',loading:false})}
  },
  async shuffle(){
    try{this.setData({recommendations:await dishesApi.recommend(2)})}
    catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  detail(e){wx.navigateTo({url:`/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}`})},
  add(e){
    const dish=this.data.recommendations.find(item=>String(item.id)===String(e.currentTarget.dataset.id))
    if(!dish)return
    cart.add(dish)
    wx.showToast({title:'已经放进小菜单啦',icon:'none'})
  },
  goMenu(){wx.switchTab({url:'/pages/menu/menu'})},
  goOrders(){wx.setStorageSync('orders_open_tab','active');wx.switchTab({url:'/pages/orders/orders'})},
  goCouple(){wx.navigateTo({url:'/pages/couple/couple'})}
})
