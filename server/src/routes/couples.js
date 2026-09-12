const router = require('express').Router()
const crypto = require('crypto')
const db = require('../config/db')
const { auth, requireCouple } = require('../middleware/auth')
const { AppError, ok, asyncRoute } = require('../utils/http')
const { ensureCoupleMenu } = require('../services/coupleMenuService')

router.use(auth)
const makeCode = () => crypto.randomBytes(4).toString('hex').toUpperCase()

router.post('/', asyncRoute(async (req, res) => {
  if (req.user.coupleId) throw new AppError('你已经有小饭桌啦')
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const code = makeCode(), name = String(req.body.name || '我们的小饭桌').trim().slice(0, 50)
    const [result] = await connection.query('INSERT INTO couples (name,invite_code,invite_expire_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))', [name, code])
    await connection.query('UPDATE users SET couple_id=? WHERE id=? AND couple_id IS NULL', [result.insertId, req.user.id])
    await connection.query('UPDATE couples SET created_by=? WHERE id=?', [req.user.id, result.insertId])
    await connection.commit(); await ensureCoupleMenu(result.insertId); ok(res, { id: result.insertId, name, inviteCode: code }, '小饭桌创建好啦')
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}))

router.post('/join', asyncRoute(async (req, res) => {
  if (req.user.coupleId) throw new AppError('你已经有小饭桌啦')
  const code = String(req.body.inviteCode || '').trim().toUpperCase()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [[couple]] = await connection.query('SELECT id,name FROM couples WHERE invite_code=? AND invite_expire_at>NOW() FOR UPDATE', [code])
    if (!couple) throw new AppError('邀请码不对或已经过期')
    const [[{ count }]] = await connection.query('SELECT COUNT(*) count FROM users WHERE couple_id=?', [couple.id])
    if (count >= 2) throw new AppError('这个小饭桌已经坐满两个人啦')
    await connection.query('UPDATE users SET couple_id=? WHERE id=? AND couple_id IS NULL', [couple.id, req.user.id])
    await connection.query('UPDATE couples SET invite_code=NULL,invite_expire_at=NULL WHERE id=?', [couple.id])
    await connection.commit(); ok(res, couple, '坐到一起啦')
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}))

router.get('/current', requireCouple, asyncRoute(async (req, res) => {
  await ensureCoupleMenu(req.user.coupleId)
  const [[couple]] = await db.query('SELECT id,name,invite_code AS inviteCode,invite_expire_at AS inviteExpireAt,anniversary,home_title AS homeTitle,home_subtitle AS homeSubtitle,created_by AS createdBy,created_at AS createdAt FROM couples WHERE id=?', [req.user.coupleId])
  const [members] = await db.query('SELECT id,nickname,avatar_url AS avatarUrl FROM users WHERE couple_id=? ORDER BY id', [req.user.coupleId])
  const [[stats]] = await db.query(`SELECT COUNT(*) meals FROM orders WHERE couple_id=? AND status='completed'`, [req.user.coupleId])
  ok(res, { ...couple, members, stats })
}))

router.post('/invite', requireCouple, asyncRoute(async(req,res)=>{
  const [[{memberCount}]]=await db.query('SELECT COUNT(*) memberCount FROM users WHERE couple_id=?',[req.user.coupleId])
  if(memberCount>=2)throw new AppError('小饭桌已经坐满两个人啦')
  const code=makeCode()
  await db.query('UPDATE couples SET invite_code=?,invite_expire_at=DATE_ADD(NOW(),INTERVAL 7 DAY) WHERE id=?',[code,req.user.coupleId])
  ok(res,{inviteCode:code},'新邀请码准备好啦')
}))

router.post('/leave', requireCouple, asyncRoute(async(req,res)=>{
  const coupleId=req.user.coupleId,connection=await db.getConnection()
  try{
    await connection.beginTransaction()
    await connection.query('SELECT id FROM couples WHERE id=? FOR UPDATE',[coupleId])
    await connection.query('DELETE f FROM favorites f JOIN dishes d ON d.id=f.dish_id WHERE f.user_id=? AND d.couple_id=?',[req.user.id,coupleId])
    await connection.query('UPDATE users SET couple_id=NULL WHERE id=? AND couple_id=?',[req.user.id,coupleId])
    const [members]=await connection.query('SELECT id FROM users WHERE couple_id=? ORDER BY id',[coupleId])
    if(!members.length){
      // Delete in dependency order. Both categories and dishes reference the
      // couple, while dishes also reference categories, so relying only on
      // parallel cascades can be rejected by InnoDB.
      await connection.query('DELETE FROM orders WHERE couple_id=?',[coupleId])
      await connection.query('DELETE FROM dishes WHERE couple_id=?',[coupleId])
      await connection.query('DELETE FROM categories WHERE couple_id=?',[coupleId])
      await connection.query('DELETE FROM couples WHERE id=?',[coupleId])
    }else await connection.query('UPDATE couples SET created_by=?,invite_code=?,invite_expire_at=DATE_ADD(NOW(),INTERVAL 7 DAY) WHERE id=?',[members[0].id,makeCode(),coupleId])
    await connection.commit();ok(res,{deleted:!members.length},'已经离开小饭桌')
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}))

router.put('/current', requireCouple, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 50)
  if (!name) throw new AppError('小饭桌也要有个名字呀')
  const anniversary = req.body.anniversary || null
  const homeTitle=String(req.body.homeTitle||'今天想吃点什么呀？').trim().slice(0,80)||'今天想吃点什么呀？'
  const homeSubtitle=String(req.body.homeSubtitle||'认真选一顿，也是在认真过日子。').trim().slice(0,120)||'认真选一顿，也是在认真过日子。'
  await db.query('UPDATE couples SET name=?,anniversary=?,home_title=?,home_subtitle=? WHERE id=?', [name,anniversary,homeTitle,homeSubtitle,req.user.coupleId])
  ok(res, { name,anniversary,homeTitle,homeSubtitle }, '小饭桌更新好啦')
}))

module.exports = router
