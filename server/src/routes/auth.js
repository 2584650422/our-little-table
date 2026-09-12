const router = require('express').Router()
const jwt = require('jsonwebtoken')
const db = require('../config/db')
const env = require('../config/env')
const { code2Session } = require('../integrations/wechat/client')
const { auth } = require('../middleware/auth')
const { AppError, ok, asyncRoute } = require('../utils/http')

function sign(user) { return jwt.sign({ sub: String(user.id) }, env.jwtSecret, { expiresIn: env.jwtExpiresIn }) }

router.post('/wechat', asyncRoute(async (req, res) => {
  const code = String(req.body.code || '')
  if (!code) throw new AppError('缺少微信登录凭证')
  const session = await code2Session(code)
  await db.query('INSERT INTO users (openid) VALUES (?) ON DUPLICATE KEY UPDATE updated_at=NOW()', [session.openid])
  const [[user]] = await db.query('SELECT id,nickname,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=?', [session.openid])
  ok(res, { token: sign(user), user })
}))

router.post('/dev', asyncRoute(async (req, res) => {
  if (!env.devLoginEnabled || env.nodeEnv === 'production') throw new AppError('开发登录未开启', 404)
  const openid = `dev_${String(req.body.identity || 'one').replace(/[^a-z0-9_-]/gi, '').slice(0, 24)}`
  await db.query('INSERT INTO users (openid,nickname) VALUES (?,?) ON DUPLICATE KEY UPDATE updated_at=NOW()', [openid, req.body.nickname || '本地体验用户'])
  const [[user]] = await db.query('SELECT id,nickname,avatar_url AS avatarUrl,couple_id AS coupleId FROM users WHERE openid=?', [openid])
  ok(res, { token: sign(user), user })
}))

router.get('/me', auth, asyncRoute(async (req, res) => ok(res, req.user)))
router.put('/me', auth, asyncRoute(async (req, res) => {
  const nickname = String(req.body.nickname || '').trim().slice(0, 30)
  if (!nickname) throw new AppError('告诉我该怎么称呼你吧')
  const avatarUrl = req.body.avatarUrl ? String(req.body.avatarUrl).slice(0, 500) : null
  await db.query('UPDATE users SET nickname=?,avatar_url=? WHERE id=?', [nickname, avatarUrl, req.user.id])
  ok(res, { ...req.user, nickname, avatarUrl }, '称呼记住啦')
}))

module.exports = router

