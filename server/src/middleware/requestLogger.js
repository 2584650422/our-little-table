const logger = require('../utils/logger')

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint()
  req.id = String(req.headers['x-request-id'] || logger.requestId()).slice(0, 80)
  res.setHeader('X-Request-Id', req.id)
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    const context = { requestId: req.id, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Number(durationMs.toFixed(1)) }
    if (res.statusCode >= 500) logger.error('http.request.completed', context)
    else if (res.statusCode >= 400) logger.warn('http.request.completed', context)
    else logger.info('http.request.completed', context)
  })
  next()
}

module.exports = requestLogger

