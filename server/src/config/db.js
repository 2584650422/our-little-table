const mysql = require('mysql2/promise')
const env = require('./env')

const pool = mysql.createPool({ ...env.mysql, waitForConnections: true, timezone: '+08:00', decimalNumbers: true })

module.exports = pool

