const logger = require('../utils/logger')

function notFound(_req, res) { res.status(404).json({ code: 404, message: '这里好像没有这个页面', data: null }) }

function errorHandler(error, req, res, _next) {
  const status = error.status || 500
  const context = { requestId: req.id, method: req.method, path: req.originalUrl, status, error }
  if (status >= 500) logger.error('http.request.failed', context)
  else logger.warn('http.request.rejected', { ...context, error: { name: error.name, message: error.message, code: error.code } })
  res.status(status).json({ code: error.code || status, message: status >= 500 ? '服务开了个小差，请稍后再试' : error.message, data: { requestId: req.id } })
}

module.exports = { notFound, errorHandler }
