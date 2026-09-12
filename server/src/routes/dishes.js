const router = require('express').Router()
const db = require('../config/db')
const { auth, requireCouple } = require('../middleware/auth')
const { AppError, ok, asyncRoute } = require('../utils/http')
const { ensureCoupleMenu } = require('../services/coupleMenuService')

router.use(auth, requireCouple)

const select = `SELECT d.id,d.name,d.description,d.image_key AS imageKey,d.image_url AS imageUrl,
 d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,d.calorie_note AS calorieNote,
 d.serving_note AS servingNote,d.cook_time_minutes AS cookTimeMinutes,d.difficulty,d.spicy_level AS spicyLevel,
 d.tags,d.enabled,d.couple_id AS coupleId,d.sort_order AS sortOrder,c.id AS categoryId,c.name AS categoryName,c.icon AS categoryIcon,
 EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=?) AS isFavorite,
 (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi JOIN orders oo ON oo.id=oi.order_id
   WHERE oo.couple_id=? AND oo.status<>'cancelled' AND (oi.dish_id=d.id OR oi.dish_name=d.name)) AS orderedCount
 FROM dishes d JOIN categories c ON c.id=d.category_id`

function normalize(row) {
  if (!row) return row
  if (typeof row.tags === 'string') { try { row.tags = JSON.parse(row.tags) } catch (_) { row.tags = [] } }
  row.tags = row.tags || []; row.isFavorite = Boolean(row.isFavorite); row.enabled = Boolean(row.enabled)
  return row
}

router.get('/', asyncRoute(async (req, res) => {
  await ensureCoupleMenu(req.user.coupleId)
  const where = ['d.couple_id=?']
  const params = [req.user.id, req.user.coupleId, req.user.coupleId]
  if (req.query.includeDisabled !== 'true') where.push('d.enabled=1')
  if (req.query.categoryId) { where.push('d.category_id=?'); params.push(Number(req.query.categoryId)) }
  if (req.query.keyword) { where.push('(d.name LIKE ? OR d.description LIKE ?)'); const q = `%${String(req.query.keyword).slice(0, 50)}%`; params.push(q, q) }
  if (req.query.favorite === 'true') where.push('EXISTS(SELECT 1 FROM favorites ff WHERE ff.dish_id=d.id AND ff.user_id=?)'), params.push(req.user.id)
  const [rows] = await db.query(`${select} WHERE ${where.join(' AND ')} ORDER BY d.sort_order,d.id`, params)
  ok(res, rows.map(normalize))
}))

router.get('/:id', asyncRoute(async (req, res) => {
  await ensureCoupleMenu(req.user.coupleId)
  const [[dish]] = await db.query(`${select} WHERE d.id=? AND d.couple_id=?`, [req.user.id, req.user.coupleId, req.params.id, req.user.coupleId])
  if (!dish) throw new AppError('这道菜找不到啦', 404)
  const [[stats]] = await db.query(`SELECT COUNT(*) eatenCount,MAX(o.completed_at) lastEatenAt FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=? AND o.couple_id=? AND o.status='completed'`, [req.params.id, req.user.coupleId])
  ok(res, { ...normalize(dish), eatenCount: stats.eatenCount, lastEatenAt: stats.lastEatenAt })
}))

function dishPayload(body) {
  const name = String(body.name || '').trim().slice(0, 80), categoryId = Number(body.categoryId)
  if (!name || !categoryId) throw new AppError('菜名和分类都要填写哦')
  const calorie = body.calorieKcal === '' || body.calorieKcal == null ? null : Number(body.calorieKcal)
  const cookTime = body.cookTimeMinutes === '' || body.cookTimeMinutes == null ? null : Number(body.cookTimeMinutes)
  return [categoryId,name,String(body.description || '').slice(0,255)||null,body.imageKey||null,body.imageUrl||null,
    Number.isFinite(calorie) ? Math.max(0, Math.round(calorie)) : null,String(body.calorieUnit||'份').slice(0,16),
    String(body.calorieNote||'家庭做法估算值').slice(0,80),String(body.servingNote||'').slice(0,80)||null,
    Number.isFinite(cookTime) ? Math.max(0,Math.round(cookTime)) : null,['easy','medium','hard'].includes(body.difficulty)?body.difficulty:null,
    body.spicyLevel == null ? null : Math.max(0,Math.min(5,Number(body.spicyLevel))),JSON.stringify(Array.isArray(body.tags)?body.tags.slice(0,8):[]),Number(body.sortOrder)||0]
}

router.post('/', asyncRoute(async (req, res) => {
  const payload = dishPayload(req.body)
  const [[category]] = await db.query('SELECT id FROM categories WHERE id=? AND couple_id=? AND enabled=1', [payload[0],req.user.coupleId])
  if(!category)throw new AppError('请选择当前小饭桌里的分类')
  const [result] = await db.query(`INSERT INTO dishes (couple_id,category_id,name,description,image_key,image_url,calorie_kcal,calorie_unit,calorie_note,serving_note,cook_time_minutes,difficulty,spicy_level,tags,sort_order,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [req.user.coupleId,...payload,req.user.id])
  ok(res, { id: result.insertId }, '新菜加进菜单啦')
}))

router.put('/:id', asyncRoute(async (req, res) => {
  const payload = dishPayload(req.body)
  const [[category]] = await db.query('SELECT id FROM categories WHERE id=? AND couple_id=? AND enabled=1', [payload[0],req.user.coupleId])
  if(!category)throw new AppError('请选择当前小饭桌里的分类')
  const [result] = await db.query(`UPDATE dishes SET category_id=?,name=?,description=?,image_key=?,image_url=?,calorie_kcal=?,calorie_unit=?,calorie_note=?,serving_note=?,cook_time_minutes=?,difficulty=?,spicy_level=?,tags=?,sort_order=? WHERE id=? AND couple_id=?`, [...payload,req.params.id,req.user.coupleId])
  if (!result.affectedRows) throw new AppError('只能编辑自己饭桌添加的菜', 403)
  ok(res, {}, '菜单更新好啦')
}))

router.delete('/:id', asyncRoute(async (req, res) => {
  const [result] = await db.query('UPDATE dishes SET enabled=0 WHERE id=? AND couple_id=?', [req.params.id,req.user.coupleId])
  if (!result.affectedRows) throw new AppError('只能下架当前小饭桌里的菜', 403)
  ok(res, {}, '已经从菜单里收起来啦')
}))

router.post('/:id/favorite', asyncRoute(async (req, res) => {
  const [[dish]] = await db.query('SELECT id FROM dishes WHERE id=? AND enabled=1 AND couple_id=?', [req.params.id,req.user.coupleId])
  if (!dish) throw new AppError('这道菜找不到啦',404)
  await db.query('INSERT IGNORE INTO favorites (user_id,dish_id) VALUES (?,?)',[req.user.id,req.params.id]); ok(res,{},'收藏好啦 ❤️')
}))
router.delete('/:id/favorite', asyncRoute(async (req,res)=>{ await db.query('DELETE FROM favorites WHERE user_id=? AND dish_id=?',[req.user.id,req.params.id]); ok(res,{},'已经取消收藏') }))

module.exports = router
