class AppError extends Error {
  constructor(message, status = 400, code = 1) { super(message); this.status = status; this.code = code }
}

const ok = (res, data = {}, message = 'ok') => res.json({ code: 0, message, data })
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

module.exports = { AppError, ok, asyncRoute }

