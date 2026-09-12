const {request}=require('./api')
const query=p=>Object.keys(p||{}).filter(k=>p[k]!==''&&p[k]!=null).map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&')
module.exports={
  list:p=>request({url:`/api/dishes?${query(p)}`}),detail:id=>request({url:`/api/dishes/${id}`}),
  categories:()=>request({url:'/api/categories'}),
  createCategory:data=>request({url:'/api/categories',method:'POST',data,loading:true}),
  updateCategory:(id,data)=>request({url:`/api/categories/${id}`,method:'PUT',data,loading:true}),
  deleteCategory:id=>request({url:`/api/categories/${id}`,method:'DELETE',loading:true}),
  favorite:(id,on)=>request({url:`/api/dishes/${id}/favorite`,method:on?'POST':'DELETE'}),
  create:data=>request({url:'/api/dishes',method:'POST',data,loading:true}),
  update:(id,data)=>request({url:`/api/dishes/${id}`,method:'PUT',data,loading:true}),
  disable:id=>request({url:`/api/dishes/${id}`,method:'DELETE'}),
  recommend:(count=1)=>request({url:`/api/recommendations/today?count=${count}`})
}
