const router=require('express').Router(),db=require('../config/db'); const {auth,requireCouple}=require('../middleware/auth'); const {ok,asyncRoute}=require('../utils/http'); router.use(auth,requireCouple)
router.get('/',asyncRoute(async(req,res)=>{const [rows]=await db.query('SELECT id,type,title,content,order_id AS orderId,read_at AS readAt,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50',[req.user.id]); const [[{unreadCount}]]=await db.query('SELECT COUNT(*) unreadCount FROM notifications WHERE user_id=? AND read_at IS NULL',[req.user.id]);ok(res,{items:rows,unreadCount})}))
router.put('/read',asyncRoute(async(req,res)=>{await db.query('UPDATE notifications SET read_at=NOW() WHERE user_id=? AND read_at IS NULL',[req.user.id]);ok(res,{})}))
module.exports=router

