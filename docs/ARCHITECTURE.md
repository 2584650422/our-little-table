# 技术架构

## 总览

```text
微信原生小程序（JavaScript/WXML/WXSS）
        │ HTTPS + JWT
        ▼
Python 3.9+ + FastAPI
   ├── MySQL 8（业务数据）
   ├── 微信 code2Session / 订阅消息
   └── 腾讯云 COS STS（图片直传）
```

项目采用单仓库双项目结构：`miniprogram/` 是可由微信开发者工具独立打开的完整前端项目，`server/` 是可单独安装、运行和部署的后端项目，数据库脚本放在 `database/`。迁移时保留了原有 AppID 和开发者工具关键配置。

## 关键决策

- 原生 JavaScript：现有工程即 JS，体量小，不引入构建链。
- FastAPI + PyMySQL：与 Python 运维、自动化和未来 AI 工具链衔接自然，所有 SQL 参数化。
- JWT：服务端只从 token 获取用户身份，不接受前端传入 `user_id`。
- 数据隔离：业务查询以 `req.user.coupleId` 作为约束；没有绑定时只开放绑定相关接口。
- 菜单归属：初始化数据独立保存在 `starter_categories`、`starter_dishes`。饭桌首次访问时在命名锁保护下复制为饭桌私有数据；业务表 `categories`、`dishes` 的 `couple_id` 强制非空。
- 订单快照：订单项复制菜名、图片 Object Key 与热量，菜单更新不会污染历史。
- 点单次数：通过当前饭桌非取消订单的 `order_items` 动态聚合，不接受客户端写入，也不提供手工修改字段。
- 可选集成降级：COS 或订阅消息配置缺失时返回明确状态，但不让点菜主流程失败。
- 点菜单保存在本机 Storage，提交时由服务端重新读取菜品并计算快照和热量，避免伪造。

## 服务端分层

- `app/main.py`：集中维护兼容的 REST 路由、JWT、饭桌权限和业务编排；当前体量下不为两人应用拆成过多服务。
- `app/config.py`：环境变量边界。
- `app/db.py`：MySQL 连接、参数化查询和事务。
- `app/storage.py`：COS Object Key 命名、短时读取签名与限定前缀清理。
- 迁移前的 Express 实现已从工作区移除；Git 提交历史仍可用于审阅或恢复旧版本。

## 状态机

```text
pending → ready → completed
   └──────→ cancelled
```

第一版用户界面只暴露“提交 → 上菜 → 吃完”：上菜将订单直接置为 `ready`，可同时保存一张成品照片；`ready` 后才可完成。旧的 `accepted`、`preparing` 状态仍能安全兼容并直接上菜。完成或取消的历史可在二次确认后删除。创建者或对方均可查看，同一饭桌成员才可操作。完成后记录进入历史，推荐算法会降低最近三天吃过菜品的权重。

## 小饭桌生命周期

- 未满两人时可生成新的 7 天邀请码；坐满后禁止继续邀请。
- 任一成员可更新饭桌名称、纪念日和饭桌首页主副标题；用户只能编辑自己的称呼，伴侣资料只读。
- 用户可同时保留多张已加入饭桌的关联，并在“创建/加入小饭桌”页切换；当前活动饭桌只记录在 `users.couple_id`，所有业务查询仍严格按其范围隔离。
- 成员退出后失去当前饭桌访问权限，但历史饭桌及其中数据不会被自动删除；需要时可通过邀请码重新加入。
- 只有创建者且饭桌只剩自己时，才可在二次确认后永久删除饭桌及其业务数据。

## 安全边界

- 微信 AppSecret、数据库密码、COS SecretKey 仅来自服务端环境变量。
- JWT 默认 7 天，生产环境必须设置高强度 `JWT_SECRET`。
- 小程序拒绝超过 10MB 的原图，并本地压缩到 2MB 以内；服务端与 STS policy 再次限制 MIME、2MB Content-Length、单一对象路径和短时效。
- COS 使用私有读写 Bucket：数据库只保存 Object Key，不保存会过期的签名 URL。每次 API 响应按当前访问权限生成短时 GET URL。
- COS 对象键由服务端生成并隔离到饭桌：`little-table/couples/<couple-public-id>/dish-images/YYYY/MM/<uuid>.<ext>`；成品照和头像同在该饭桌前缀下。删除整张饭桌会清理整个前缀；菜品下架是软删除，因此保留其图片与历史快照。
- CORS、请求体大小和统一错误输出均受限；生产日志不输出密钥、session_key 或 access_token。

## 推荐算法

候选为当前饭桌 `enabled=1` 的菜。基础随机分加上个人收藏奖励与距上次完成订单的天数奖励；三天内吃过会扣分。算法仅用于排序后从高分候选中抽取，避免固定结果，不涉及 AI。

## 配置边界

- 小程序 API 根地址：`miniprogram/config/index.js`。
- 后端全部配置：`server/.env`（模板见 `.env.example`）。
- `miniprogram/project.config.json` 的 AppID 和开发者工具关键选项保持不变。
