# 我们的时光

两个人私密共享的生活记录小程序，包含小饭桌、日历和足迹。底部导航为首页、小饭桌、日历、足迹、我们。它不涉及交易、支付、配送或商业经营。

- **小饭桌**：共享菜谱、点菜上菜、每顿快照、饭后记录、个人收藏与消息提醒。
- **日历**：当天记录、生日、纪念日、公历和农历倒数日；记录显示作者，按类型区分颜色。
- **足迹**：地图选点、完整照片与预览图、最多 9 张批量保存。
- **共同空间**：两名成员、称呼头像、起始日、首页文案和成员管理。

暖纸色、鼠尾草绿和现有交互以 [已确认的原型决定](docs/prototype-decisions.md) 为准。历史小饭桌原型在 `docs/prototypes/`，它们只对应饭桌模块，不代表当前五个主页面。

## 项目目录

| 目录 | 内容 |
|---|---|
| `miniprogram/` | 自包含的原生微信小程序；开发者工具打开此目录 |
| `server/app/` | FastAPI API、空间隔离、日历、照片和 COS |
| `server/tests/`、`tests/` | 后端与小程序行为测试 |
| `database/` | 新库 schema、可选模板、015 改名迁移、表说明源数据 |
| `scripts/` | 本地数据库说明生成工具 |
| `server/scripts/` | 只读迁移核对、隔离库集成检查、图片导入工具 |
| `server/k8s/` | 当前服务器部署资源与配置同步脚本 |
| `docs/` | 原型、功能、数据库、配置和发布记录 |

## 数据库

当前命名为 `our_time`，17 张表按空间、饭桌、日历、足迹、消息和维护划分。完整中文解释见 [数据库表说明](docs/database-tables.md)，数据库内可执行：

```sql
SELECT table_name, module, purpose, contents, privacy_note FROM table_guide ORDER BY module, table_name;
```

`subscription_grants` 保存订阅授权的防重复记录，`subscription_credits` 保存预计剩余提醒次数。模板 ID、OpenID、UUID 都是标识符，不能当成无用的加密内容清空。

**全新空库**：`mysql -u root -p < database/schema.sql`。`seed.sql` 仅提供可选公共菜单模板，不创建用户或演示记录。已有 `little_table` 数据库按 [015 迁移手册](docs/schema-refactor.md) 操作，不重导 schema，也不重跑 001–014。

## 本地开发

```bash
cd server
cp .env.example .env
# 填写 MySQL、JWT、微信和 COS 配置，真密钥只留在 .env
make install
make dev
```

小程序 API 地址在 `miniprogram/config/index.js`。真机预览使用可访问的 HTTPS 后端；生产密钥不能进入前端或 Git。

## 检查与格式化

```bash
npm ci
npm test
npm run format:check
python3 scripts/build_schema_docs.py --check
cd server
make check
make test
```

维护代码时使用 `npm run format` 格式化前端 JS/WXSS；后端先安装 `requirements-dev.txt`，再运行 `make format`。格式工具仅用于开发，不加入小程序或服务器运行时。

## 继续阅读

[产品与原型](docs/prototype-decisions.md) · [生活空间](docs/life-space.md) · [架构](docs/architecture.md) · [配置](docs/configuration.md) · [数据库迁移](docs/schema-refactor.md) · [发布](docs/releasing.md) · [部署](docs/deployment.md) · [微信消息](docs/notifications.md)


想你了模块：首页四模块入口、留言回复与已读、统一微信提醒偏好、日历只读回看。数据库016与上线顺序见 [说明](docs/thoughts.md)。
