# 部署说明

生产环境分两组 Compose：公共 `compose/docker-compose.yml` 管理 MySQL、Nginx 和 Typecho PHP；小饭桌 `server/compose.production.yml` 只管理 API。服务器对应目录分别是 `/data/software/compose/` 与 `/data/software/compose/little-table/server/`，两组容器通过 `compose_blog-network` 通信。当前公共配置使用 MySQL 5.7.44。小程序前端由微信开发者工具上传、审核并发布，不通过 Docker 部署。

## 首次准备

1. 确认服务器的公共容器、`compose_blog-network` 和 `little_table` 数据库正常。全新数据库可导入 `database/schema.sql` 和 `database/seed.sql`；已有数据库**不要**重导，先核对迁移记录，只运行尚未执行的脚本。`007_remove_category_icons.sql` 会删除旧列，执行前要有可验证的备份，并确认当前 API 不再使用这些列。
2. 把 `server/` 的 `Dockerfile`、`requirements.txt`、`app/` 和 `compose.production.yml` 放在服务器 `/data/software/compose/little-table/server/`。服务器 `.env` 保持在同一目录，权限 `600`，不上传到 Git。具体同步命令见[容器运维](CONTAINER_OPERATIONS.md)。
3. 在服务器 `.env` 填 MySQL、JWT、微信登录等配置。Compose 将 `MYSQL_HOST=mysql` 等生产值覆盖为容器网络地址。各字段说明见[配置指南](CONFIGURATION_GUIDE.md)；通知模板见[消息通知](NOTIFICATIONS.md)。
4. Nginx 为 API 提供 HTTPS，配置可参考 `server/little-table.nginx.conf`。当前 API 仅在 Docker 网络中暴露 3000 端口；Nginx 应通过容器名 `little-table-api:3000` 转发。修改线上 Nginx 前先备份配置，并执行 `nginx -t` 后 reload。

## 构建与更新 API

在服务器运行：

```bash
cd /data/software/compose/little-table/server
sudo chmod 600 .env
sudo docker compose -f compose.production.yml config --quiet
sudo docker compose -f compose.production.yml up -d --build --force-recreate api
sudo docker compose -f compose.production.yml ps
curl -fsS https://aaa.imlyc.cn/health
```

预期 `/health` 返回 `database: connected`。修改 `.env` 也要 `up -d --force-recreate api`；`restart` 不会向已有容器注入新的环境变量。更新 API 不需要停止 MySQL，更不能对生产库重导 schema/seed。查看日志、排错、备份和回滚命令见[容器运维](CONTAINER_OPERATIONS.md)。

## 发布小程序

1. 将 `miniprogram/config/index.js` 指向正式 HTTPS API 地址，确认 `miniprogram/project.config.json` 的 AppID 正确。
2. 在微信小程序后台登记 API 的 request 合法域名。COS 直传还需将实际 COS 域名登记为 request 合法域名；图片读取域名按使用方式登记为 downloadFile 合法域名，并正确配置 COS CORS。AppSecret、COS 永久密钥和微信模板 ID 只放后端。
3. 如需验证前端更新提示，上传前更新 `miniprogram/services/updates.js` 的 `BUILD_ID`；在仓库根目录的终端运行 `node --test tests/miniprogram-update.test.js` 可检查更新逻辑。上传代码、提交审核、审核通过和**点击发布**是不同阶段，普通入口只有正式发布后才可能取得新代码。
4. 用两位成员的真机完成登录、创建/加入、点菜、上菜、历史记录、图片上传和通知验证。站内消息和微信订阅消息应分别检查；`/health` 不能证明微信消息送达。

微信新包由客户端检查和下载。**旧代码若尚未包含更新监听功能，它无法显示新版弹窗**；这类设备首次更新可能要完全关闭并重新进入小程序。即使已有更新监听，微信仍决定新包何时可下载；重新打开、清空 Storage 或 `wx.reLaunch` 不能强制取得新代码。用户可在“我们 → 版本与更新”查看当前渠道、包标识和更新状态。体验版/预览版要用各自二维码验证，不等同于电脑普通入口的正式版。

## 数据与密钥放在哪里

- 业务库由公共 MySQL 容器保存；备份只在服务器 `/data/software/compose/backups/`，不进入 Git。
- 公共 Compose 的 `/data/software/compose/.env` 提供 `MYSQL_ROOT_PASSWORD`，由 Docker Compose 展开 `${MYSQL_ROOT_PASSWORD}`；它**不是** API 的环境文件。
- API Compose 通过 `env_file: .env` 读取 `/data/software/compose/little-table/server/.env`。后端 `app/config.py` 用 `os.getenv()` 读取这些变量。两份 `.env` 都只留服务器，并限制为 `600`。
- `compose/` 中仅保存可公开的 Compose、Dockerfile 和说明；Nginx 证书、站点文件、数据库数据和 Typecho 私有配置仍留服务器。
