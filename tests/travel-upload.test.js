const test=require('node:test'),assert=require('node:assert/strict')
// Original dimensions are not a screenshot concern: guard the source upload path
// against accidental reintroduction of the food crop/compress pipeline.
for(const [width,height] of [[4032,3024],[1920,1080],[3024,4032],[12000,1000]]) test(`travel upload preserves ${width}×${height} original bytes and uploads a separate preview`,async()=>{
 let cropped=false,compressed=[],puts=[],credentialCalls=[]
 const original=Buffer.from('source-image'),preview=Buffer.from('preview')
 global.wx={getFileInfo:o=>o.success({size:o.filePath==='original.jpg'?original.length:preview.length}),getImageInfo:o=>o.success({width:o.src==='original.jpg'?width:1280,height:o.src==='original.jpg'?height:Math.round(height/width*1280),type:'jpeg'}),compressImage:o=>{compressed.push(o);o.success({tempFilePath:'preview.jpg'})},cropImage:()=>{cropped=true},getFileSystemManager:()=>({readFile:o=>o.success({data:o.filePath==='original.jpg'?original:preview})}),request:o=>{puts.push(o);o.success({statusCode:200})}}
 const api=require('../miniprogram/services/api'),old=api.request;api.request=async o=>{credentialCalls.push(o);return {bucket:'test',region:'test',key:o.data.purpose,expiredTime:Math.floor(Date.now()/1000)+900,credentials:{tmpSecretKey:'test',tmpSecretId:'test',sessionToken:'test'}}}
 delete require.cache[require.resolve('../miniprogram/services/upload')]
 try{const result=await require('../miniprogram/services/upload').uploadTravelPhoto('original.jpg');assert.equal(cropped,false);assert.equal(puts[0].data,original);assert.equal(puts[1].data,preview);assert.equal(result.width,width);assert.equal(result.height,height);assert.equal(compressed[0].compressedWidth,1280);assert.deepEqual(credentialCalls.map(o=>o.data.purpose),['travel_original','travel_preview'])}finally{api.request=old;delete global.wx}
})
