# 小饭桌容器运维

服务器上，小饭桌 API 的源码、Dockerfile、`compose.production.yml` 与私有 `.env` 同在 `/data/software/compose/little-table/server/`。公共 MySQL、Nginx、Typecho PHP 位于 `/data/software/compose/`，使用另一份 `docker-compose.yml`。两组容器共享 `compose_blog-network`；API 不向公网开放 3000 端口。

## 同步并更新 API

本机已配置 SSH 别名 `lyc` 时，可在仓库根目录执行以下示例。它只同步构建所需的文件，不覆盖服务器 `.env`。如果服务器目录中有尚未纳入 Git 的手工修改，先比较后再同步。

```bash
rsync -av server/Dockerfile server/requirements.txt server/compose.production.yml lyc:/data/software/compose/little-table/server/
rsync -av --exclude='__pycache__/' --exclude='*.pyc' server/app/ lyc:/data/software/compose/little-table/server/app/
ssh lyc 'cd /data/software/compose/little-table/server && sudo docker compose -f compose.production.yml config --quiet && sudo docker compose -f compose.production.yml up -d --build --force-recreate api && sudo docker compose -f compose.production.yml ps'
```

如果 SSH 用户不能写上述目录，需要先传到自己的家目录，再由有权限的账号安装。`config --quiet` 可验证 Compose 语法而不打印展开后的密钥。更新前建议确认最近的数据库备份和当前镜像可用；涉及数据库迁移时，先核对已执行编号、备份与新旧 API 兼容性。

部署后验证：

```bash
ssh lyc 'sudo docker exec little-table-api python -c "import urllib.request; print(urllib.request.urlopen(\"http://127.0.0.1:3000/health\").read().decode())"'
curl -fsS https://aaa.imlyc.cn/health
```

`/health` 预期返回 `database: connected`。它只检查 API 和数据库，不证明微信通知或 COS 上传成功。

## 看状态和日志

在服务器上：

```bash
cd /data/software/compose/little-table/server
sudo docker compose -f compose.production.yml ps
sudo docker compose -f compose.production.yml logs --tail=200 api
sudo docker compose -f compose.production.yml logs -f --since=10m api
```

API 日志在 Docker stdout/stderr 中，Compose 配置了每文件 10 MB、最多 3 个文件的轮转。用 `requestId` 关联请求；微信通知可查 `wechat.subscribe_*`，图片上传失败可查 `cos.client_upload_failed`。不要把 `.env` 或 `docker inspect` 输出的完整环境变量贴到聊天里。

COS 链路是“小程序申请 STS → 直接 PUT 到 COS”。日志里的 `cos.credential_issued` 只说明凭证签发成功；若之后失败，先查微信后台的 **request 合法域名**、COS CORS 的 `PUT` 和请求头、Bucket/Region、以及客户端返回的 COS Request ID。上传不经过 Nginx 的普通 API 路由。

## 改 `.env` 或 Nginx

API 环境文件在 `/data/software/compose/little-table/server/.env`，权限 `600`。修改后运行：

```bash
cd /data/software/compose/little-table/server
sudo docker compose -f compose.production.yml config --quiet
sudo docker compose -f compose.production.yml up -d --force-recreate api
```

`restart` 只重启现有容器，不能注入改过的环境变量。公共 MySQL 的密码变量另在 `/data/software/compose/.env`，由公共 Compose 在解析 `${MYSQL_ROOT_PASSWORD}` 时读取；两份文件不要混用。

Nginx 配置位于 `/data/software/compose/nginx/conf/conf.d/little-table.conf`。修改前备份目标文件，之后验证再加载：

```bash
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
curl -fsS https://aaa.imlyc.cn/health
```

## 备份、迁移与回滚

生产数据库备份保存在 `/data/software/compose/backups/`。恢复前核对备份时间、能否完整读取、数据库版本和对当前数据的影响。不要对已有生产库重导 `schema.sql` / `seed.sql`，也不要重复执行已运行的迁移。`007` 包含删列，尤其不能在仍需旧列的 API 上提前运行。

如果要保留更新前镜像，可在构建前给当前 `latest` 打标签：

```bash
sudo docker image tag little-table-api:latest little-table-api:rollback-YYYYMMDD-HHMMSS
```

回滚时将下面的标签替换为实际已保存的标签：

```bash
sudo docker image tag little-table-api:rollback-YYYYMMDD-HHMMSS little-table-api:latest
sudo docker compose -f /data/software/compose/little-table/server/compose.production.yml up -d --no-build --force-recreate api
```

镜像回滚只恢复应用程序；数据库结构或数据变更必须单独评估兼容性。旧 `006`、`007` 迁移已在 2026-09-27 的生产库执行；2026-09-30 的目录整理把 API 放入当前目录，并保留新的全库逻辑备份。具体可用恢复点应以服务器现存文件为准，不能只依据旧文档中的历史镜像名。
