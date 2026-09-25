const dishesApi=require('../../services/dishes')
const {request}=require('../../services/api')
const cart=require('../../utils/cart')
const homeCopy=require('../../utils/home-copy')
const layout=require('../../utils/layout')

Page({
  data:{
    topInset:layout.topInset(),greeting:'',homeTitle:homeCopy.defaults.title,
    homeSubtitle:homeCopy.defaults.subtitle,recommendations:[],recommendationIndex:0,
    loading:true,error:'',needsCouple:false
  },
  onShow(){this.bootstrap()},
  async bootstrap(){
    const now=new Date(),h=now.getHours()
    const cachedCopy=homeCopy.get()
    this.setData({
      greeting:h<11?'早上好':h<17?'下午好':'晚上好',
      homeTitle:cachedCopy.title,homeSubtitle:cachedCopy.subtitle,loading:true,error:''
    })
    try{
      await getApp().loginPromise
      const user=wx.getStorageSync('user')
      if(!user?.coupleId){homeCopy.clear();this.setData({needsCouple:true,loading:false});return}
      const [couple,recommendations]=await Promise.all([
        request({url:'/api/couples/current'}),dishesApi.recommend(3)
      ])
      const savedCopy=homeCopy.save(couple)
      this.setData({
        homeTitle:savedCopy.title,homeSubtitle:savedCopy.subtitle,
        recommendations,recommendationIndex:0,needsCouple:false,loading:false
      })
    }catch(e){this.setData({error:e.message||'网络好像开小差了',loading:false})}
  },
  async shuffle(){
    if(this.data.recommendationIndex<this.data.recommendations.length-1){this.setData({recommendationIndex:this.data.recommendationIndex+1});return}
    try{this.setData({recommendations:await dishesApi.recommend(3),recommendationIndex:0})}
    catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  recommendChanged(e){this.setData({recommendationIndex:e.detail.current})},
  detail(e){wx.navigateTo({url:`/pages/dish-detail/dish-detail?id=${e.currentTarget.dataset.id}`})},
  add(e){
    const dish=this.data.recommendations.find(item=>String(item.id)===String(e.currentTarget.dataset.id))
    if(!dish)return
    cart.add(dish)
    wx.showToast({title:'已经放进小菜单啦',icon:'none'})
  },
  goMenu(){wx.switchTab({url:'/pages/menu/menu'})},
  goCouple(){wx.navigateTo({url:'/pages/couple/couple'})}
})
