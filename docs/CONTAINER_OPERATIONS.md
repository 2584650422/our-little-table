# 后端容器部署与日常运维

本文针对当前生产环境：小饭桌后端 Dockerfile、源码和独立 Compose 文件均位于 `/data/software/compose/little-table/server`；MySQL、Nginx 和 Typecho PHP 使用 `/data/software/compose/docker-compose.yml` 统一管理。API 通过 `compose_blog-network` 访问 MySQL 容器 `mysql:3306`。小程序前端由微信开发者工具上传，不由 Compose 提供。

## 首次部署前检查

确认服务器已安装 Docker Compose 插件，并且已存在外部网络：

```bash
sudo docker compose version
sudo docker network inspect compose_blog-network >/dev/null
sudo docker ps --format 'table {{.Names}}\t{{.Status}}'
```

服务器的 `server/` 只保留构建和运行 API 所需的文件，Compose 文件与源码放在同一目录。同步时不覆盖服务器真实 `.env`，也不上传本地虚拟环境、测试、导入脚本及旧备份：

```bash
rsync -av \
  ./server/Dockerfile ./server/requirements.txt ./server/compose.production.yml \
  lyc:/data/software/compose/little-table/server/
rsync -av --delete --delete-excluded \
  --exclude='__pycache__/' --exclude='*.pyc' \
  ./server/app/ lyc:/data/software/compose/little-table/server/app/
```

以上示例使用本机 SSH 别名 `lyc`；其他机器需替换为自己的主机名。`--delete` 只作用于服务器的 `app/` 目录，首次同步或目录中有手工文件时，先去掉该参数并检查差异。Compose 中的 `name: server` 沿用既有容器的项目名。真实 `.env` 只在服务器上维护，权限应为 `600`；不要粘贴进聊天、工单或 Git。

## 首次启动或更新

```bash
cd /data/software/compose/little-table/server
sudo chmod 600 .env
sudo docker compose -f compose.production.yml config --quiet
sudo docker compose -f compose.production.yml build api
sudo docker compose -f compose.production.yml up -d --force-recreate api
sudo docker compose -f compose.production.yml ps
```

若是首次部署且尚未构建镜像，`up` 可以直接带 `--build`：

```bash
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml up -d --build --force-recreate api
```

部署完成后验证容器内和 HTTPS 公网健康检查：

```bash
sudo docker exec little-table-api python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:3000/health').read().decode())"
curl -fsS https://YOUR_API_DOMAIN/health
```

预期返回 `status: ok` 和 `database: connected`。MySQL 是已有服务，更新 API 时不要对它执行 `docker compose down`，也不要重新导入 schema/seed。

## 查看日志和时区

```bash
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml logs --tail=200 api
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml logs -f --since=10m api
date
sudo docker exec little-table-api date
```

容器通过 `TZ=Asia/Shanghai` 和只读挂载 `/etc/localtime` 使用服务器本地时区。若两者仍不一致，先检查宿主机时钟和时区：

```bash
timedatectl status
```

请求日志按状态码分级：成功请求为 `INFO`，4xx 为 `WARNING`，5xx 为 `ERROR`；`/health` 和 Nginx 周期探测用的 `GET /`（预期 404）降到 `DEBUG`，Uvicorn 默认逐条 access log 已关闭，避免重复。HTTP 客户端不记录含凭证查询参数的完整 URL；COS SDK 的连接池绑定提示降为 `WARNING`，避免每次生成图片临时链接都刷屏。日志由 Docker `json-file` 驱动轮转，当前 Compose 限制为每个文件 10 MB、最多 3 个文件。

排查时使用日志里的 `requestId` 关联同一次 API 调用。不要用 `docker inspect` 输出完整环境变量，也不要向聊天粘贴 `.env` 或带密钥的命令输出。

## COS 图片上传排错

图片链路是“小程序 → API 申请临时 STS 凭证 → 小程序直接 PUT 到 COS”。因此 API 日志出现 `cos.credential_issued` 只表示临时凭证成功签发，不代表后续 COS PUT 成功；COS 返回的 4xx/5xx 原本只在小程序端发生。

新版本小程序会在直传失败后调用已登录的 `/api/uploads/cos-failure`，服务器日志记录 `cos.client_upload_failed`，包含上传用途、COS 状态码、COS Request ID（若响应头可读）和错误代码，不记录签名、临时密钥或图片内容。客户端本地调试时也可在微信开发者工具 Console 中查看 `[COS upload]` 诊断信息。

如仍失败，按以下顺序核对：

1. 后台确认 `cos.credential_issued` 的紧接后续是否有 `cos.client_upload_failed`。
2. `status=403` 时，用日志中的 COS Request ID 在腾讯云 COS 请求日志/工单中查询具体拒绝原因，重点检查 STS 权限、对象 Key 范围、Region/Bucket、签名时钟与内容类型条件。
3. `status=0` 或 `client_network_failure` 时，检查微信公众平台 `request` 合法域名包含准确的 COS 域名，以及小程序当前网络、证书和 COS CORS 规则。
4. COS CORS 允许 `PUT`，允许请求头 `Authorization`、`x-cos-security-token`、`Content-Type`；建议暴露 `x-cos-request-id` 响应头用于排错。COS Bucket 保持私有读写。
5. 修改 CORS 或合法域名后，重新编译小程序并真机复测。`uploadFile` 合法域名不是本项目 PUT 直传所用的配置项。

`GET /` 的 404 不是图片上传错误；上传请求签发凭证后直接发往 COS，不会经过 Nginx/API 的普通路由日志。

## 修改环境变量

在服务器本机编辑：

```bash
cd /data/software/compose/little-table/server
nano .env
sudo chmod 600 .env
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml up -d --force-recreate api
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml logs --tail=100 api
```

改 `.env` 后只执行 `restart` 不会把新环境变量注入已有容器；必须 recreate。比如微信 AppSecret 轮换后，应先在公众平台生成新值，再只在服务器 `.env` 更新 `WECHAT_APP_SECRET`，随后 recreate 并验证登录。不要把 AppSecret 发给协作者或写入小程序前端。

## Nginx 与域名

当前 API Nginx 配置位于服务器 `/data/software/compose/nginx/conf/conf.d/little-table.conf`。修改前备份目标配置，完成后执行：

```bash
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
curl -fsSI https://YOUR_API_DOMAIN/health
```

不要直接覆盖已备份的旧 `wechat.conf`，也不要把 API 容器的 3000 端口暴露到公网。Nginx 和 API 通过外部 Docker 网络互通。

## 回滚 API 镜像

更新前记录当前镜像：

```bash
sudo docker image tag little-table-api:latest little-table-api:rollback-YYYYMMDD-HHMMSS
```

需要回滚时把 `YYYYMMDD-HHMMSS` 替换为实际标签：

```bash
sudo docker image tag little-table-api:rollback-YYYYMMDD-HHMMSS little-table-api:latest
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml up -d --no-build --force-recreate api
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml ps
```

该回滚仅恢复应用镜像；若发布包含数据库迁移，需按相应迁移文档单独制定兼容/回滚方案。当前 API 更新不应自动重置或删除生产数据。

## 本次饭桌背景与分类字段升级

本次 `006_couple_background.sql` 只增加 `couples.background_image_key`，可在旧 API 运行期间先执行。`007_remove_category_icons.sql` 清理 `categories.icon`、`starter_categories.icon` 和始终为空的 `meal_reviews.rating`，是不可逆的删列操作，**必须先部署新版 API、验证 `/health`、`/api/categories` 与 `/api/dishes` 正常，再执行**；旧版 API 仍会查询 `categories.icon`，提前删列会让菜单接口失败。生产库不要重新执行 `schema.sql`/`seed.sql`。

执行 `007` 之前应使用现有备份方案保留 MySQL 全库或至少 `categories`、`starter_categories` 的结构与数据，确认备份可恢复。迁移脚本保留在本地 Git 仓库的 `database/migrations/`，不再常驻服务器；下方记录表明这两项迁移已经执行，不要重复运行。

新的微信消息模板变量见 [消息通知配置](NOTIFICATIONS.md)。修改 `.env` 后要重新创建 API 容器；新版小程序应在新版 API 部署后再上传，否则消息配置接口会返回 404。

### 2026-09-27 实际执行记录

- 已在现有 `little_table` 库执行 `006_couple_background.sql` 与 `007_remove_category_icons.sql`，并确认 `categories.icon`、`starter_categories.icon`、`meal_reviews.rating` 不再存在。
- 删除字段前曾保留完整数据库备份、旧 API 源码备份和 `little-table-api:rollback-20260927-115133` 镜像。它们均已于 2026-09-30 清理；当前源码以 Git 为准，数据库恢复点见下方目录整理记录。
- 新 API 已构建并重建容器；`/health`、饭桌、分类、菜品、消息与消息配置接口通过检查。真实创建/上菜测试验证两位成员均有站内消息，测试记录已删除。清理中发现并修复空评论结果导致删除接口返回 500 的问题，复测删除返回 200。
- 当时生产 `.env` 尚未配置微信订阅消息 Template ID 及字段键，日志记录了 `wechat.subscribe_skipped ... reason=not_configured`；这只能证明发送分支被调用，**不能证明微信外部消息送达**。这是 2026-09-27 的历史状态，现行配置以服务器环境和真机测试结果为准。
- 已将生产 `WECHAT_ORDER_PAGE` 从 Tab 页改为 `pages/order-detail/order-detail` 并重建容器；当时的 `.env` 私密备份已在 2026-09-30 清理，现行环境文件只保留在服务器 `server/.env`，不要复制进 Git。
- 当时饭桌的“番茄炒蛋”“宫保鸡丁”已替换成新生成图片；新对象私有读取返回 200，旧对象返回 404，且没有订单图片快照引用旧图。通知联调测试订单 `11` 在两位成员处均验证了“已下单”和“已上菜”站内消息，随后已删除；当时容器日志记录了四条 `wechat.subscribe_skipped`。

### 2026-09-30 目录整理

- 小饭桌完整目录迁至 `/data/software/compose/little-table/`，API 继续使用独立的 `server/compose.production.yml`；公共 MySQL、Nginx、PHP 仍由 `/data/software/compose/docker-compose.yml` 管理。
- 已验证并删除旧的 `/data/software/little-table/backups/`、2026-08-17 服务器迁移快照和未挂载的 MySQL 原始数据副本。当前全库逻辑备份为 `/data/software/compose/backups/mysql-all-20260930-110347.sql.gz`，权限 `600`，已验证压缩文件可完整读取。恢复前应先确认备份时间和数据库版本。
