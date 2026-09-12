const KEY='today_menu'
const get=()=>wx.getStorageSync(KEY)||[]
function add(dish,quantity=1){
  const list=get(),found=list.find(item=>String(item.dishId)===String(dish.id))
  if(found){found.quantity+=quantity;if(!found.categoryId&&dish.categoryId)found.categoryId=dish.categoryId}
  else list.push({dishId:dish.id,categoryId:dish.categoryId||null,dishName:dish.name,imageUrl:dish.imageUrl||'',calorieKcal:dish.calorieKcal,calorieUnit:dish.calorieUnit||'份',quantity})
  wx.setStorageSync(KEY,list)
  return list
}
const save=list=>wx.setStorageSync(KEY,list)
const clear=()=>wx.removeStorageSync(KEY)
module.exports={get,add,save,clear}
