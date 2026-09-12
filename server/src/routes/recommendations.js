const router = require('express').Router()
const db = require('../config/db')
const { auth, requireCouple } = require('../middleware/auth')
const { ok, asyncRoute } = require('../utils/http')
const { pick } = require('../services/recommendationService')
const { ensureCoupleMenu } = require('../services/coupleMenuService')
router.use(auth, requireCouple)
router.get('/today', asyncRoute(async (req,res)=>{
  await ensureCoupleMenu(req.user.coupleId)
  const [rows]=await db.query(`SELECT d.id,d.name,d.description,d.image_url AS imageUrl,d.calorie_kcal AS calorieKcal,d.calorie_unit AS calorieUnit,c.name AS categoryName,
  EXISTS(SELECT 1 FROM favorites f WHERE f.dish_id=d.id AND f.user_id=?) isFavorite,
  (SELECT MAX(o.completed_at) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.dish_id=d.id AND o.couple_id=? AND o.status='completed') lastEatenAt
  FROM dishes d JOIN categories c ON c.id=d.category_id WHERE d.enabled=1 AND d.couple_id=?`,[req.user.id,req.user.coupleId,req.user.coupleId])
  ok(res,pick(rows,Number(req.query.count)||1))
}))
module.exports=router
