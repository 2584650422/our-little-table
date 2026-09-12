const { randomUUID } = require('crypto')
const env = require('../config/env')

const levels = { debug: 10, info: 20, warn: 30, error: 40 }
const configuredLevel = levels[env.log.level] ? env.log.level : 'info'
const secretKey = /(password|secret|token|authorization|session.?key)/i

function sanitize(value, seen = new WeakSet()) {
  if (value instanceof Error) {
    return sanitize({ name: value.name, message: value.message, code: value.code, errno: value.errno, syscall: value.syscall, address: value.address, port: value.port, stack: value.stack }, seen)
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => sanitize(item, seen))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : sanitize(item, seen)]))
}

function write(level, message, context = {}) {
  if (levels[level] < levels[configuredLevel]) return
  const safeContext = sanitize(context)
  const entry = { time: new Date().toISOString(), level, pid: process.pid, message, ...safeContext }
  const output = env.log.format === 'json'
    ? JSON.stringify(entry)
    : `[${entry.time}] ${level.toUpperCase()} pid=${process.pid} ${message}${Object.keys(context).length ? ` ${JSON.stringify(safeContext)}` : ''}`
  ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(output)
}

module.exports = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  requestId: () => randomUUID()
}
