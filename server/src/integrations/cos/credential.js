const STS = require('qcloud-cos-sts')
const { randomUUID } = require('crypto')
const env = require('../../config/env')
const { AppError } = require('../../utils/http')

const allowed = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function getCredential({ mimeType, size, purpose }) {
  if (!allowed[mimeType] || !Number.isFinite(size) || size <= 0 || size > env.cos.maxMb * 1024 * 1024) {
    throw new AppError(`仅支持不超过 ${env.cos.maxMb}MB 的 JPG、PNG、WEBP 图片`)
  }
  if (!env.cos.secretId || !env.cos.secretKey || !env.cos.bucket || !env.cos.region) {
    throw new AppError('图片上传暂未配置', 503)
  }
  const now = new Date(),folder=purpose==='avatar'?'avatar-images':purpose==='meal'?'meal-images':'dish-images'
  const key = `${folder}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${allowed[mimeType]}`
  const shortBucket = env.cos.bucket.replace(/-\d+$/, '')
  const appId = env.cos.bucket.slice(shortBucket.length + 1)
  return new Promise((resolve, reject) => STS.getCredential({
    secretId: env.cos.secretId, secretKey: env.cos.secretKey, durationSeconds: 900,
    policy: { version: '2.0', statement: [{
      effect: 'allow', action: ['name/cos:PutObject'], resource: [`qcs::cos:${env.cos.region}:uid/${appId}:${shortBucket}/${key}`],
      condition: { numeric_less_than_equal: { 'cos:content-length': env.cos.maxMb * 1024 * 1024 }, string_equal: { 'cos:content-type': mimeType } }
    }] }
  }, (error, credential) => error ? reject(error) : resolve({
    credentials: credential.credentials, startTime: credential.startTime, expiredTime: credential.expiredTime,
    bucket: env.cos.bucket, region: env.cos.region, key,
    url: env.cos.baseUrl ? `${env.cos.baseUrl}/${key}` : `https://${env.cos.bucket}.cos.${env.cos.region}.myqcloud.com/${key}`
  })))
}

module.exports = { getCredential }
