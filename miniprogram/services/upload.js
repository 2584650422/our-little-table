const {request}=require('./api')
const MAX_ORIGINAL_BYTES=10*1024*1024
const TARGET_UPLOAD_BYTES=2*1024*1024
function info(path){return new Promise((resolve,reject)=>wx.getFileInfo({filePath:path,success:resolve,fail:reject}))}
function read(path){return new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,success:r=>resolve(r.data),fail:reject}))}
function imageInfo(path){return new Promise((resolve,reject)=>wx.getImageInfo({src:path,success:resolve,fail:reject}))}
function crop(path,purpose){if(!wx.cropImage)throw new Error('当前微信版本不支持图片裁切，请更新微信后再试');return new Promise((resolve,reject)=>wx.cropImage({src:path,cropScale:purpose==='avatar'?'1:1':'4:3',success:r=>resolve(r.tempFilePath),fail:reject}))}
function compress(path,quality,width){return new Promise((resolve,reject)=>wx.compressImage({src:path,quality,compressedWidth:width,success:r=>resolve(r.tempFilePath),fail:reject}))}
function reportFailure(data){request({url:'/api/uploads/cos-failure',method:'POST',data}).catch(()=>{})}
function hmacSha1(key,message){try{return Promise.resolve(require('../utils/crypto-lite').hmacSha1(message,key))}catch(_){return Promise.reject(new Error('本地 COS 签名组件加载失败，请重新编译小程序'))}}
// COS V5 requires the request Host to be in the canonical signed headers.
async function buildAuthorization(data,method,path,host){const start=Math.floor(Date.now()/1000)-1,end=data.expiredTime,keyTime=`${start};${end}`,signKey=await hmacSha1(data.credentials.tmpSecretKey,keyTime),httpString=`${method.toLowerCase()}\n${path}\n\nhost=${host}\n`,sha1=require('../utils/crypto-lite').sha1(httpString),stringToSign=`sha1\n${keyTime}\n${sha1}\n`,signature=await hmacSha1(signKey,stringToSign);return `q-sign-algorithm=sha1&q-ak=${data.credentials.tmpSecretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`}
async function uploadImage(path,purpose='dish',onStage){
  let original,file,uploadPath=path,data
  try{original=await info(path)}catch(_){throw new Error('读取图片失败，请重新选择一张')}
  if(original.size>MAX_ORIGINAL_BYTES)throw new Error('原图超过 10MB，请选择更小的图片')
  onStage?.('cropping')
  try{uploadPath=await crop(path,purpose)}catch(e){if(String(e.errMsg||'').includes('cancel'))throw e;throw new Error('图片裁切失败，请重新选择一张')}
  const croppedPath=uploadPath
  try{
    onStage?.('compressing')
    const dimension=await imageInfo(croppedPath)
    const maxWidth=purpose==='avatar'?640:1280
    uploadPath=await compress(croppedPath,82,Math.min(dimension.width,maxWidth))
    file=await info(uploadPath)
    if(file.size>TARGET_UPLOAD_BYTES){uploadPath=await compress(croppedPath,66,Math.min(dimension.width,purpose==='avatar'?480:1000));file=await info(uploadPath)}
  }catch(e){console.warn('[image compression] failed',{errMsg:e.errMsg||String(e)});throw new Error('图片压缩失败，请重新选择或拍摄一张')}
  if(file.size>TARGET_UPLOAD_BYTES)throw new Error('图片压缩后仍超过 2MB，请裁小一点再试')
  let type=''
  try{type=((await imageInfo(uploadPath)).type||'').toLowerCase()}catch(_){type=(uploadPath.split('.').pop()||'').toLowerCase()}
  const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}
  if(!types[type])type=(uploadPath.split('.').pop()||'').toLowerCase()
  const mimeType=types[type]
  if(!mimeType)throw new Error('仅支持 JPG、PNG 或 WEBP 图片，请换一张再试')
  try{onStage?.('credential');data=await request({url:'/api/uploads/cos-credential',method:'POST',data:{mimeType,size:file.size,purpose}})}catch(e){throw new Error(`获取上传凭证失败：${e.message||'请检查后端服务'}`)}
  const host=`${data.bucket}.cos.${data.region}.myqcloud.com`
  let authorization,body
  try{onStage?.('uploading');authorization=await buildAuthorization(data,'PUT',`/${data.key}`,host);body=await read(uploadPath)}catch(e){throw new Error(`准备图片失败：${e.message||'请重新选择图片'}`)}
  return new Promise((resolve,reject)=>wx.request({url:`https://${host}/${data.key}`,method:'PUT',data:body,timeout:15000,header:{Authorization:authorization,'x-cos-security-token':data.credentials.sessionToken,'Content-Type':mimeType},success:r=>{if(r.statusCode>=200&&r.statusCode<300)return resolve({imageKey:data.key,imageUrl:data.url,originalSize:original.size,uploadSize:file.size});const headers=r.header||{},requestId=headers['x-cos-request-id']||headers['X-Cos-Request-Id']||headers['x-cos-requestid']||'';const xml=typeof r.data==='string'?r.data:'',errorCode=(xml.match(/<Code>([^<]+)<\/Code>/)||[])[1]||'cos_http_error';console.warn('[COS upload] rejected',{statusCode:r.statusCode,requestId,errorCode});reportFailure({purpose,statusCode:r.statusCode,cosRequestId:requestId,errorCode});reject(new Error(`图片上传失败（COS ${r.statusCode}）`))},fail:e=>{console.warn('[COS upload] network failure',{errMsg:e.errMsg||''});reportFailure({purpose,statusCode:0,errorCode:'client_network_failure'});reject(new Error(`图片上传网络失败：${e.errMsg||'请检查网络或 COS 域名设置'}`))}}))
}
module.exports={uploadImage}
