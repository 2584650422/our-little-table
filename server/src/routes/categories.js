const router = require('express').Router()
const db = require('../config/db')
const { auth, requireCouple } = require('../middleware/auth')
const { AppError, ok, asyncRoute } = require('../utils/http')
const { ensureCoupleMenu } = require('../services/coupleMenuService')
router.use(auth, requireCouple)
router.get('/', asyncRoute(async (req,res)=>{
  await ensureCoupleMenu(req.user.coupleId)
  const [rows]=await db.query('SELECT id,name,icon,sort_order AS sortOrder FROM categories WHERE couple_id=? AND enabled=1 ORDER BY sort_order,id',[req.user.coupleId])
  ok(res,rows)
}))
router.post('/', asyncRoute(async(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,30),icon=String(req.body.icon||'🍽️').trim().slice(0,16)||'🍽️',sortOrder=Number(req.body.sortOrder)||0
  if(!name)throw new AppError('分类名称不能为空')
  try{const [result]=await db.query('INSERT INTO categories (couple_id,name,icon,sort_order,created_by) VALUES (?,?,?,?,?)',[req.user.coupleId,name,icon,sortOrder,req.user.id]);ok(res,{id:result.insertId},'分类添加好啦')}
  catch(error){if(error.code==='ER_DUP_ENTRY')throw new AppError('已经有同名分类啦');throw error}
}))
router.put('/:id', asyncRoute(async(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,30),icon=String(req.body.icon||'🍽️').trim().slice(0,16)||'🍽️',sortOrder=Number(req.body.sortOrder)||0
  if(!name)throw new AppError('分类名称不能为空')
  try{const [result]=await db.query('UPDATE categories SET name=?,icon=?,sort_order=? WHERE id=? AND couple_id=? AND enabled=1',[name,icon,sortOrder,req.params.id,req.user.coupleId]);if(!result.affectedRows)throw new AppError('分类找不到啦',404);ok(res,{},'分类更新好啦')}
  catch(error){if(error.code==='ER_DUP_ENTRY')throw new AppError('已经有同名分类啦');throw error}
}))
router.delete('/:id', asyncRoute(async(req,res)=>{
  const [[{dishCount}]]=await db.query('SELECT COUNT(*) dishCount FROM dishes WHERE category_id=? AND couple_id=? AND enabled=1',[req.params.id,req.user.coupleId])
  if(dishCount)throw new AppError(`这个分类里还有 ${dishCount} 道菜，请先移动或下架`)
  const [result]=await db.query('UPDATE categories SET enabled=0 WHERE id=? AND couple_id=?',[req.params.id,req.user.coupleId])
  if(!result.affectedRows)throw new AppError('分类找不到啦',404)
  ok(res,{},'分类已经收起来啦')
}))
module.exports = router
