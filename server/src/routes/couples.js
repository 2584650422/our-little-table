const router = require('express').Router()
const crypto = require('crypto')
const db = require('../config/db')
const { auth, requireCouple } = require('../middleware/auth')
const { AppError, ok, asyncRoute } = require('../utils/http')
const { ensureCoupleMenu } = require('../services/coupleMenuService')

router.use(auth)
const makeCode=()=>crypto.randomBytes(4).toString('hex').toUpperCase()
const makePublicId=()=>crypto.randomUUID()
async function memberCount(connection,coupleId){const [[row]]=await connection.query('SELECT COUNT(*) count FROM couple_members WHERE couple_id=? AND left_at IS NULL',[coupleId]);return row.count}
async function selectFallbackCouple(connection,userId,excludedId){const [[row]]=await connection.query('SELECT couple_id AS coupleId FROM couple_members WHERE user_id=? AND left_at IS NULL AND couple_id<>? ORDER BY joined_at DESC LIMIT 1',[userId,excludedId]);return row?.coupleId||null}

router.get('/mine',asyncRoute(async(req,res)=>{
  const [rows]=await db.query(`SELECT c.id,c.public_id AS publicId,c.name,DATE_FORMAT(c.anniversary,'%Y-%m-%d') AS anniversary,c.home_title AS homeTitle,c.home_subtitle AS homeSubtitle,DATE_FORMAT(cm.joined_at,'%Y-%m-%d %H:%i') AS joinedAt,c.id=? AS isCurrent,(SELECT COUNT(*) FROM couple_members m WHERE m.couple_id=c.id AND m.left_at IS NULL) AS memberCount FROM couple_members cm JOIN couples c ON c.id=cm.couple_id WHERE cm.user_id=? AND cm.left_at IS NULL ORDER BY isCurrent DESC,cm.joined_at DESC`,[req.user.coupleId||0,req.user.id])
  ok(res,rows)
}))

router.post('/',asyncRoute(async(req,res)=>{
  const connection=await db.getConnection()
  try{await connection.beginTransaction();const name=String(req.body.name||'我们的小饭桌').trim().slice(0,50)||'我们的小饭桌';const [result]=await connection.query('INSERT INTO couples (public_id,name,invite_code,invite_expire_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 7 DAY))',[makePublicId(),name,makeCode()]);await connection.query('INSERT INTO couple_members (couple_id,user_id) VALUES (?,?)',[result.insertId,req.user.id]);await connection.query('UPDATE users SET couple_id=? WHERE id=?',[result.insertId,req.user.id]);await connection.query('UPDATE couples SET created_by=? WHERE id=?',[req.user.id,result.insertId]);await connection.commit();await ensureCoupleMenu(result.insertId);const [[couple]]=await db.query('SELECT id,public_id AS publicId,name,invite_code AS inviteCode FROM couples WHERE id=?',[result.insertId]);ok(res,couple,'小饭桌创建好啦')}catch(error){await connection.rollback();throw error}finally{connection.release()}
}))

router.post('/join',asyncRoute(async(req,res)=>{
  const code=String(req.body.inviteCode||'').trim().toUpperCase(),connection=await db.getConnection()
  try{await connection.beginTransaction();const [[couple]]=await connection.query('SELECT id,name,public_id AS publicId FROM couples WHERE invite_code=? AND invite_expire_at>NOW() FOR UPDATE',[code]);if(!couple)throw new AppError('邀请码不对或已经过期');const [[existing]]=await connection.query('SELECT id,left_at AS leftAt FROM couple_members WHERE couple_id=? AND user_id=? FOR UPDATE',[couple.id,req.user.id]);if(existing?.leftAt)await connection.query('UPDATE couple_members SET left_at=NULL,joined_at=NOW() WHERE id=?',[existing.id]);else if(!existing){if(await memberCount(connection,couple.id)>=2)throw new AppError('这个小饭桌已经坐满两个人啦');await connection.query('INSERT INTO couple_members (couple_id,user_id) VALUES (?,?)',[couple.id,req.user.id]);await connection.query('UPDATE couples SET invite_code=NULL,invite_expire_at=NULL WHERE id=?',[couple.id])}await connection.query('UPDATE users SET couple_id=? WHERE id=?',[couple.id,req.user.id]);await connection.commit();await ensureCoupleMenu(couple.id);ok(res,couple,'坐到一起啦')}catch(error){await connection.rollback();throw error}finally{connection.release()}
}))

router.post('/switch/:id',asyncRoute(async(req,res)=>{const coupleId=Number(req.params.id);const [[membership]]=await db.query('SELECT couple_id FROM couple_members WHERE couple_id=? AND user_id=? AND left_at IS NULL',[coupleId,req.user.id]);if(!membership)throw new AppError('你还没有加入这个小饭桌');await db.query('UPDATE users SET couple_id=? WHERE id=?',[coupleId,req.user.id]);await ensureCoupleMenu(coupleId);const [[couple]]=await db.query('SELECT id,public_id AS publicId,name FROM couples WHERE id=?',[coupleId]);ok(res,couple,'已经切换到这个小饭桌')}))

router.get('/current',requireCouple,asyncRoute(async(req,res)=>{await ensureCoupleMenu(req.user.coupleId);const [[couple]]=await db.query("SELECT id,public_id AS publicId,name,invite_code AS inviteCode,DATE_FORMAT(invite_expire_at,'%Y-%m-%d %H:%i') AS inviteExpireAt,DATE_FORMAT(anniversary,'%Y-%m-%d') AS anniversary,home_title AS homeTitle,home_subtitle AS homeSubtitle,created_by AS createdBy,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS createdAt FROM couples WHERE id=?",[req.user.coupleId]);const [members]=await db.query('SELECT u.id,u.nickname,u.avatar_url AS avatarUrl FROM couple_members cm JOIN users u ON u.id=cm.user_id WHERE cm.couple_id=? AND cm.left_at IS NULL ORDER BY cm.joined_at,u.id',[req.user.coupleId]);const [[stats]]=await db.query("SELECT COUNT(*) meals FROM orders WHERE couple_id=? AND status='completed'",[req.user.coupleId]);ok(res,{...couple,members,stats})}))

router.post('/invite',requireCouple,asyncRoute(async(req,res)=>{if(await memberCount(db,req.user.coupleId)>=2)throw new AppError('小饭桌已经坐满两个人啦');const code=makeCode();await db.query('UPDATE couples SET invite_code=?,invite_expire_at=DATE_ADD(NOW(),INTERVAL 7 DAY) WHERE id=?',[code,req.user.coupleId]);ok(res,{inviteCode:code},'新邀请码准备好啦')}))

router.post('/leave',requireCouple,asyncRoute(async(req,res)=>{const coupleId=req.user.coupleId,connection=await db.getConnection();try{await connection.beginTransaction();await connection.query('UPDATE couple_members SET left_at=NOW() WHERE couple_id=? AND user_id=? AND left_at IS NULL',[coupleId,req.user.id]);const fallback=await selectFallbackCouple(connection,req.user.id,coupleId);await connection.query('UPDATE users SET couple_id=? WHERE id=?',[fallback,req.user.id]);await connection.commit();ok(res,{currentCoupleId:fallback},'已经退出当前小饭桌，历史数据仍会保留')}catch(error){await connection.rollback();throw error}finally{connection.release()}}))

router.delete('/current',requireCouple,asyncRoute(async(req,res)=>{const coupleId=req.user.coupleId,connection=await db.getConnection();try{await connection.beginTransaction();const [[couple]]=await connection.query('SELECT created_by AS createdBy FROM couples WHERE id=? FOR UPDATE',[coupleId]);if(!couple||Number(couple.createdBy)!==Number(req.user.id))throw new AppError('只有创建者可以删除小饭桌',403);if(await memberCount(connection,coupleId)>1)throw new AppError('请先让另一位成员退出，再删除小饭桌');const fallback=await selectFallbackCouple(connection,req.user.id,coupleId);await connection.query('UPDATE users SET couple_id=? WHERE id=?',[fallback,req.user.id]);await connection.query('DELETE FROM orders WHERE couple_id=?',[coupleId]);await connection.query('DELETE FROM dishes WHERE couple_id=?',[coupleId]);await connection.query('DELETE FROM categories WHERE couple_id=?',[coupleId]);await connection.query('DELETE FROM couples WHERE id=?',[coupleId]);await connection.commit();ok(res,{currentCoupleId:fallback},'小饭桌已删除')}catch(error){await connection.rollback();throw error}finally{connection.release()}}))

router.put('/current',requireCouple,asyncRoute(async(req,res)=>{const name=String(req.body.name||'').trim().slice(0,50);if(!name)throw new AppError('小饭桌也要有个名字呀');const anniversary=req.body.anniversary||null,homeTitle=String(req.body.homeTitle||'今天想吃点什么呀？').trim().slice(0,80)||'今天想吃点什么呀？',homeSubtitle=String(req.body.homeSubtitle||'认真选一顿，也是在认真过日子。').trim().slice(0,120)||'认真选一顿，也是在认真过日子。';await db.query('UPDATE couples SET name=?,anniversary=?,home_title=?,home_subtitle=? WHERE id=?',[name,anniversary,homeTitle,homeSubtitle,req.user.coupleId]);ok(res,{name,anniversary,homeTitle,homeSubtitle},'小饭桌更新好啦')}))

module.exports=router
