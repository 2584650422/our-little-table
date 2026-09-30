# 技术架构

```text
微信原生小程序 ── HTTPS / JWT ── FastAPI ── MySQL
       │                           │
       └──── 临时凭证直传 COS ◀─────┘
                    FastAPI 也负责微信登录与订阅消息发送
```

前端在 `miniprogram/`（JavaScript、WXML、WXSS），后端在 `server/`（Python 3.9+、FastAPI、PyMySQL），数据库结构在 `database/`。生产环境使用现有 MySQL 5.7.44。普通业务接口统一返回 `{ code, message, data }`。

## 数据与权限

- 微信 `wx.login` 的 code 交给后端换取用户身份；后端签发 JWT。业务身份从 token 得到，不采信前端自填的用户 ID 或饭桌 ID。
- 每张饭桌最多两位成员。用户可以保留多张饭桌的成员关系，但一次只选择一张当前饭桌；业务查询按 token 对应的当前 `couple_id` 限定。
- 新饭桌从 `starter_categories`、`starter_dishes` 复制私有菜单。两人都能维护饭桌背景、饭桌名称、首页主副标题、分类和菜品；头像、称呼和收藏属于个人。
- 菜品删除使用 `enabled=0` 软下架。订单项保存菜名、图片和热量快照，因此后来改菜单不会改掉历史记录。热量只是估算，未填写时不显示。
- 提交点菜后状态为 `pending`，上菜后为 `ready` 并计入“吃过”；旧记录中的 `completed` 也按已吃过处理。`accepted`、`preparing` 是兼容旧数据的状态，不是当前界面的额外步骤。取消订单为 `cancelled`。
- 推荐只用当前饭桌的可用菜品、个人收藏和近期吃过记录做规则排序，不调用 AI。

## 后端各文件

- `server/app/main.py`：路由、饭桌权限与业务流程，包含点菜、上菜和消息。
- `server/app/config.py`：环境变量和默认值。
- `server/app/db.py`：参数化查询与事务。
- `server/app/storage.py`：COS 临时上传凭证、对象归属和短时读取链接。

后端负责向微信发送订阅消息。接收人需要事先主动授权，预计机会按用户和模板分别记录；微信送达失败不应让点菜或上菜失败。小程序内消息留在数据库中，详见[消息通知](notifications.md)。

## 图片和密钥

小程序向后端申请限定对象路径与时效的 COS 临时凭证，然后直接上传至私有 Bucket；数据库保存 Object Key，读取时由后端签短时 URL。永久 COS 密钥、微信 AppSecret、数据库密码和 JWT 密钥只在后端环境变量中。小程序只保存 API 地址；上传限制和裁切规则见[图片规范](image-policy.md)。

## 部署边界

服务器公共 MySQL、Nginx、Typecho PHP 由独立的 `/data/software/compose/docker-compose.yml` 管理；小饭桌 API 使用 `server/compose.production.yml`，通过外部 `compose_blog-network` 与它们通信。生产目录和命令见[部署说明](deployment.md)。
