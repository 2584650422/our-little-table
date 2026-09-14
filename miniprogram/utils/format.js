const meal={breakfast:'早餐',lunch:'午餐',dinner:'晚餐',late_night:'夜宵',snack:'零食',casual:'随便吃点'}
const status={pending:'等待上菜',accepted:'等待上菜',preparing:'等待上菜',ready:'已上菜',completed:'已上菜',cancelled:'已取消'}
function date(value){
  if(!value)return''
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const base=match?`${match[1]}-${match[2]}-${match[3]}`:null
  const d=base?new Date(`${base}T12:00:00`):new Date(value)
  if(Number.isNaN(d.getTime()))return''
  const weekdays=['日','一','二','三','四','五','六']
  return `${d.getMonth()+1}月${d.getDate()}日 · 周${weekdays[d.getDay()]}`
}
function dateTime(value){
  const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
  return match?`${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`:''
}
module.exports={meal,status,date,dateTime}
