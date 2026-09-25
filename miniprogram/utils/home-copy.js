const KEY='couple_home_copy'
const defaults={title:'今天想吃什么？',subtitle:'和你一起吃饭，就是好日子'}

function normalize(value={}){
  return {
    title:String(value.homeTitle||value.title||defaults.title).trim()||defaults.title,
    subtitle:String(value.homeSubtitle||value.subtitle||defaults.subtitle).trim()||defaults.subtitle
  }
}

function get(){return normalize(wx.getStorageSync(KEY)||{})}
function save(value){const copy=normalize(value);wx.setStorageSync(KEY,copy);return copy}
function clear(){wx.removeStorageSync(KEY)}

module.exports={defaults,get,save,clear}
