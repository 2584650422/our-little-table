# 技术架构

## 总览

```text
微信原生小程序（JavaScript/WXML/WXSS）
        │ HTTPS + JWT
        ▼
Node.js 20 + Express
   ├── MySQL 8（业务数据）
   ├── 微信 code2Session / 订阅消息
   └── 腾讯云 COS STS（图片直传）
```

项目采用单仓库双项目结构：`miniprogram/` 是可由微信开发者工具独立打开的完整前端项目，`server/` 是可单独安装、运行和部署的后端项目，数据库脚本放在 `database/`。迁移时保留了原有 AppID 和开发者工具关键配置。

## 关键决策

- 原生 JavaScript：现有工程即 JS，体量小，不引入构建链。
- Express + `mysql2/promise`：足够清晰且部署成本低，所有 SQL 参数化。
- JWT：服务端只从 token 获取用户身份，不接受前端传入 `user_id`。
- 数据隔离：业务查询以 `req.user.coupleId` 作为约束；没有绑定时只开放绑定相关接口。
- 菜单归属：初始化数据独立保存在 `starter_categories`、`starter_dishes`。饭桌首次访问时在命名锁保护下复制为饭桌私有数据；业务表 `categories`、`dishes` 的 `couple_id` 强制非空。
- 订单快照：订单项复制菜名、图片与热量，菜单更新不会污染历史。
- 点单次数：通过当前饭桌非取消订单的 `order_items` 动态聚合，不接受客户端写入，也不提供手工修改字段。
- 可选集成降级：COS 或订阅消息配置缺失时返回明确状态，但不让点菜主流程失败。
- 点菜单保存在本机 Storage，提交时由服务端重新读取菜品并计算快照和热量，避免伪造。

## 服务端分层

- `routes/`：参数解析、HTTP 语义和接口编排。
- `services/`：推荐、通知、上传等业务/集成逻辑。
- `middleware/`：JWT、饭桌绑定校验、错误处理。
- `config/`：环境变量和 MySQL 连接池。
- `integrations/`：微信与 COS SDK 边界。

## 状态机

```text
pending → accepted → preparing → ready → completed
    └──────────────→ cancelled
```

只能按顺序推进；创建者或对方均可查看，同一饭桌成员才可操作。完成后记录进入历史，推荐算法会降低最近三天吃过菜品的权重。

## 小饭桌生命周期

- 未满两人时可生成新的 7 天邀请码；坐满后禁止继续邀请。
- 任一成员可更新饭桌名称、纪念日和饭桌首页主副标题；用户只能编辑自己的称呼，伴侣资料只读。
- 成员退出后失去该饭桌全部访问权限；另一位仍在时数据保留并自动生成新邀请码。
- 最后一位成员退出时删除饭桌，并由外键级联清理其菜单、订单和通知。

## 安全边界

- 微信 AppSecret、数据库密码、COS SecretKey 仅来自服务端环境变量。
- JWT 默认 7 天，生产环境必须设置高强度 `JWT_SECRET`。
- 所有上传先校验 MIME 与不超过 5MB 的文件大小；STS policy 再次约束 Content-Type、Content-Length、单一对象路径和短时效。
- COS 对象键由服务端生成：菜品使用 `dish-images/YYYY/MM/<uuid>.<ext>`，成员头像使用 `avatar-images/YYYY/MM/<uuid>.<ext>`。
- CORS、请求体大小和统一错误输出均受限；生产日志不输出密钥、session_key 或 access_token。

## 推荐算法

候选为当前饭桌 `enabled=1` 的菜。基础随机分加上个人收藏奖励与距上次完成订单的天数奖励；三天内吃过会扣分。算法仅用于排序后从高分候选中抽取，避免固定结果，不涉及 AI。

## 配置边界

- 小程序 API 根地址：`miniprogram/config/index.js`。
- 后端全部配置：`server/.env`（模板见 `.env.example`）。
- `miniprogram/project.config.json` 的 AppID 和开发者工具关键选项保持不变。
