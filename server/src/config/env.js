require('dotenv').config()

const int = (value, fallback) => Number.parseInt(value || fallback, 10)
const nodeEnv = process.env.NODE_ENV || 'development'

module.exports = {
  nodeEnv,
  port: int(process.env.PORT, 3000),
  jwtSecret: process.env.JWT_SECRET || 'development-only-change-me-please',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1', port: int(process.env.MYSQL_PORT, 3306),
    database: process.env.MYSQL_DATABASE || 'little_table', user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '', connectionLimit: int(process.env.MYSQL_CONNECTION_LIMIT, 10),
    connectTimeout: int(process.env.MYSQL_CONNECT_TIMEOUT_MS, 5000)
  },
  wechat: {
    appId: process.env.WECHAT_APP_ID || '', appSecret: process.env.WECHAT_APP_SECRET || '',
    templateId: process.env.WECHAT_ORDER_TEMPLATE_ID || '', page: process.env.WECHAT_ORDER_PAGE || 'pages/orders/orders',
    fields: { meal: process.env.WECHAT_TEMPLATE_MEAL_KEY || '', dishes: process.env.WECHAT_TEMPLATE_DISH_KEY || '', message: process.env.WECHAT_TEMPLATE_MESSAGE_KEY || '', date: process.env.WECHAT_TEMPLATE_DATE_KEY || '' }
  },
  cos: {
    secretId: process.env.COS_SECRET_ID || '', secretKey: process.env.COS_SECRET_KEY || '',
    bucket: process.env.COS_BUCKET || '', region: process.env.COS_REGION || '',
    baseUrl: (process.env.COS_BASE_URL || '').replace(/\/$/, ''), maxMb: int(process.env.COS_UPLOAD_MAX_MB, 5)
  },
  devLoginEnabled: process.env.DEV_LOGIN_ENABLED === 'true',
  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || (nodeEnv === 'production' ? 'json' : 'pretty')
  }
}
