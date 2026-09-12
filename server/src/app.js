const express = require('express')
const cors = require('cors')
const env = require('./config/env')
const db = require('./config/db')
const logger = require('./utils/logger')
const requestLogger = require('./middleware/requestLogger')
const { notFound, errorHandler } = require('./middleware/error')

const app = express()
app.disable('x-powered-by')
app.use(cors({ origin: true }))
app.use(express.json({ limit: '256kb' }))
app.use(requestLogger)

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1')
    res.json({ code: 0, message: 'ok', data: { status: 'ok', database: 'connected', pid: process.pid, requestId: req.id } })
  } catch (error) {
    logger.error('database.health_check_failed', {
      requestId: req.id,
      database: { host: env.mysql.host, port: env.mysql.port, name: env.mysql.database, user: env.mysql.user },
      error
    })
    res.status(503).json({ code: 503, message: '数据库尚未连接', data: { status: 'degraded', database: 'disconnected', pid: process.pid, requestId: req.id } })
  }
})

app.use('/api/auth', require('./routes/auth'))
app.use('/api/couples', require('./routes/couples'))
app.use('/api/categories', require('./routes/categories'))
app.use('/api/dishes', require('./routes/dishes'))
app.use('/api/recommendations', require('./routes/recommendations'))
app.use('/api/orders', require('./routes/orders'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/uploads', require('./routes/uploads'))
app.use(notFound)
app.use(errorHandler)

let server

async function shutdown(signal, exitCode = 0) {
  logger.info('server.stopping', { signal, pid: process.pid })
  const forceTimer = setTimeout(() => process.exit(1), 5000)
  forceTimer.unref()
  if (server) await new Promise(resolve => server.close(resolve))
  await db.end().catch(error => logger.warn('database.pool_close_failed', { error }))
  process.exit(exitCode)
}

function start() {
  server = app.listen(env.port, () => {
    logger.info('server.started', {
      pid: process.pid,
      parentPid: process.ppid,
      environment: env.nodeEnv,
      listen: `http://127.0.0.1:${env.port}`,
      health: `http://127.0.0.1:${env.port}/health`,
      database: { host: env.mysql.host, port: env.mysql.port, name: env.mysql.database, user: env.mysql.user, credentialsConfigured: Boolean(env.mysql.user && env.mysql.password) },
      integrations: {
        wechatConfigured: Boolean(env.wechat.appId && env.wechat.appSecret),
        cosConfigured: Boolean(env.cos.secretId && env.cos.secretKey && env.cos.bucket && env.cos.region),
        subscribeMessageConfigured: Boolean(env.wechat.templateId)
      }
    })
  })

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') logger.error('server.port_in_use', { port: env.port, suggestion: `lsof -nP -iTCP:${env.port} -sTCP:LISTEN` })
    else logger.error('server.listen_failed', { error })
    process.exit(1)
  })
}

if (require.main === module) {
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.on('uncaughtException', error => { logger.error('process.uncaught_exception', { error }); shutdown('uncaughtException', 1) })
  process.on('unhandledRejection', error => logger.error('process.unhandled_rejection', { error }))
  start()
}

module.exports = app
