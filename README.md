# 两个人的小饭桌

这是一个只给两个人使用的微信小程序：把想吃的菜放进同一份菜单，点菜、上菜，再把这一顿留在“吃过”里。它没有价格、支付或配送功能。

两位饭桌成员共享菜单、点菜记录、饭桌背景与首页文案；收藏、头像和称呼各自管理。提交点菜后，对方可收到提醒；上菜后，点菜人可收到完成提醒。小程序内消息会保留，微信订阅消息则取决于接收人是否有可用的一次性授权机会。

## 从哪里开始

| 想做什么 | 阅读 |
| --- | --- |
| 本机启动后端、填写环境变量 | [配置指南](docs/CONFIGURATION_GUIDE.md)、[后端说明](server/README.md) |
| 在服务器部署或更新 API | [部署说明](docs/DEPLOYMENT.md)、[容器运维](docs/CONTAINER_OPERATIONS.md) |
| 理解微信提醒与预计次数 | [消息通知](docs/NOTIFICATIONS.md) |
| 了解页面和业务规则 | [产品设计](docs/PRODUCT_DESIGN.md)、[技术架构](docs/ARCHITECTURE.md) |
| 管理图片或查看页面视觉稿 | [图片规范](docs/IMAGE_POLICY.md)、[页面原型](docs/prototypes/README.md) |

## 代码在哪里

- `miniprogram/`：原生微信小程序，可直接用微信开发者工具打开。API 地址在 `miniprogram/config/index.js`。
- `server/`：Python 3.9+、FastAPI、PyMySQL 后端；`server/README.md` 介绍代码与测试。
- `database/`：全新数据库用 `schema.sql`、`seed.sql`；已有数据库的增量脚本在 `migrations/`。
- `compose/`：服务器公共 MySQL、Nginx 和 Typecho PHP 的 Compose 配置。小饭桌 API 使用 `server/compose.production.yml` 独立管理。
- `docs/`：产品、配置、部署及运维说明。

## 本机快速运行

先准备 MySQL，**仅对全新数据库**在仓库根目录执行：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

然后启动后端：

```bash
cd server
cp .env.example .env
# 编辑 .env：至少填写 MySQL、JWT_SECRET；微信登录还需要 AppID 和 AppSecret
make install
make dev
```

另开终端运行 `curl http://127.0.0.1:3000/health`，确认返回 `database: connected`。用微信开发者工具打开 **`miniprogram/` 目录**，并把 `miniprogram/config/index.js` 的 API 地址改成当前后端地址。真机访问本机服务时不能使用 `127.0.0.1`；正式环境必须使用微信后台登记的 HTTPS 域名。详细步骤见[配置指南](docs/CONFIGURATION_GUIDE.md)。

已有数据库不要重新导入 `schema.sql` 或 `seed.sql`。先确认已执行到哪个迁移编号，再依次执行**尚未执行**的 `database/migrations/` 脚本；删列迁移 `007` 尤其要先备份并核对新旧 API 的兼容性。服务器现有部署和备份操作见[容器运维](docs/CONTAINER_OPERATIONS.md)。

## 日常检查

在 `server/` 下执行 `make check` 检查 Python 语法、`make test` 运行后端回归测试；小程序更新逻辑可在仓库根目录运行 `node --test tests/miniprogram-update.test.js`。服务端健康检查只验证 API 与数据库连接，微信消息是否送达仍需两位成员在真机上验证。

`.env`、密钥、数据库数据和证书只留在运行环境，不提交到 Git。小程序前端只保存 API 地址；微信模板 ID 由后端配置并通过接口提供给前端。
