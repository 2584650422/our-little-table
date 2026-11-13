> 当前产品为「我们的时光」，数据库 `our_time`。空间隔离列为 `space_id`，外部 API 保留旧 coupleId/orderId 兼容字段。表说明见 [数据库表说明](database-tables.md)，015 切换见 [迁移手册](schema-refactor.md)。

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
- 每张饭桌最多两位成员。用户可以保留多张饭桌的成员关系，但一次只选择一张当前饭桌；业务查询按 token 对应的当前 `space_id` 限定。
- 新饭桌从空白菜单开始；`category_templates`、`dish_templates` 作为示例模板保留，但创建和访问饭桌时不会自动复制。两人都能维护饭桌背景、饭桌名称、首页主副标题、分类和菜品；头像、称呼和收藏属于个人。
- 菜品删除使用 `enabled=0` 软下架。订单项保存菜名、图片和热量快照，因此后来改菜单不会改掉历史记录。热量只是估算，未填写时不显示。
- 提交点菜后状态为 `pending`，上菜后为 `ready` 并计入“吃过”；旧记录中的 `completed` 也按已吃过处理。`accepted`、`preparing` 是兼容旧数据的状态，不是当前界面的额外步骤。取消订单为 `cancelled`。
- 推荐只用当前饭桌的可用菜品、个人收藏和近期吃过记录做规则排序，不调用 AI。

## 后端各文件

- `server/app/main.py`：路由、饭桌权限与业务流程，包含点菜、上菜和消息。
- `server/app/life.py`：生活空间摘要、首页、日历记录、公历农历与照片接口。
- `server/app/config.py`：环境变量和默认值。
- `server/app/db.py`：参数化查询与事务。
- `server/app/storage.py`：COS 临时上传凭证、对象归属和短时读取链接。

后端负责向微信发送订阅消息。接收人需要事先主动授权，预计机会按用户和模板分别记录；微信送达失败不应让点菜或上菜失败。小程序内消息留在数据库中，详见[消息通知](notifications.md)。

## 图片和密钥

小程序向后端申请限定对象路径与时效的 COS 临时凭证，然后直接上传至私有 Bucket；数据库保存 Object Key，读取时由后端签短时 URL。永久 COS 密钥、微信 AppSecret、数据库密码和 JWT 密钥只在后端环境变量中。小程序只保存 API 地址；上传限制和裁切规则见[图片规范](image-policy.md)。

## 部署边界

K3s 内置 Traefik 作为 Gateway API 控制器，统一接收公网 80/443；HTTPRoute 将流量送到集群内业务 Nginx，再由它转发到小饭桌 API、Typecho PHP 或宿主机上的 allinssl。API、Nginx、PHP 都使用 ClusterIP Service。MySQL 留在 Docker，通过节点地址供 K3s 使用。生产目录和命令见[部署说明](deployment.md)。

### 照片信息修改与空间恢复（2026-11-06）

照片详情和修改按 token-derived space ID 过滤，只更新地点、坐标、日期、描述。对象 key、作者和图片尺寸不属于编辑字段。空间登录依据小程序微信 OpenID，邀请码不是账号或恢复凭证。历史空间恢复仅允许该 token 用户已有历史成员记录的空间；事务锁空间行并检查两人上限，其他加入入口同样持有空间行锁。邀请码仍短期有效且使用即关闭。


## 想你了（016）

`server/app/thoughts.py` 承接空间隔离的留言/回复、阅读与软删除；`notification_preferences` 保存本人各类微信接收偏好，复用原订阅授权与余额表，发送仍用BackgroundTasks。`thought_messages` 记录微信请求状态与幂等编号；同一空间行锁保证重复发送去重和冷却判断跨进程一致。日历通过当天只读接口回看，不生成重复日历事件。详见 [模块说明](thoughts.md)。
