const jwt = require('jsonwebtoken')
const db = require('../config/db')
const env = require('../config/env')
const { AppError } = require('../utils/http')

async function auth(req, _res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) throw new AppError('请先登录', 401, 401)
    const payload = jwt.verify(token, env.jwtSecret)
    const [[user]] = await db.query('SELECT id, openid, nickname, avatar_url AS avatarUrl, couple_id AS coupleId FROM users WHERE id=?', [payload.sub])
    if (!user) throw new AppError('登录状态已失效', 401, 401)
    req.user = user
    next()
  } catch (error) { next(error.name === 'JsonWebTokenError' ? new AppError('登录状态已失效', 401, 401) : error) }
}

function requireCouple(req, _res, next) {
  if (!req.user.coupleId) return next(new AppError('请先创建或加入小饭桌', 403, 403))
  next()
}

module.exports = { auth, requireCouple }

