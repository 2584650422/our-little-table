# 服务器公共容器

`docker-compose.yml` 是服务器 `/data/software/compose/docker-compose.yml` 的版本化配置，只管理 MySQL、Nginx 和 Typecho PHP。小饭桌 API 保持独立：其源码、Dockerfile、依赖清单和 `compose.production.yml` 一起放在仓库 `server/`，服务器对应路径为 `/data/software/compose/little-table/server/`。两组容器通过已有的 `compose_blog-network` 通信。

仓库只保存 Compose、PHP Dockerfile 和说明。数据库数据、Nginx 证书与站点文件、`php/config.inc.php`、服务器 `/data/software/compose/.env` 等运行数据或密钥均留在服务器，不复制进 Git。`.env` 权限应为 `600`，其中提供 `MYSQL_ROOT_PASSWORD`。

服务器当前 MySQL 全库逻辑备份保存在 `/data/software/compose/backups/`，不随仓库同步。历史迁移镜像包及未挂载的原始数据副本已清理。

从仓库根目录同步公共配置时，先上传到普通用户目录，再安装到服务器的运维目录：

```bash
scp compose/docker-compose.yml lyc:~/docker-compose.new.yml
ssh lyc 'sudo install -m 644 ~/docker-compose.new.yml /data/software/compose/docker-compose.yml && /bin/rm -f ~/docker-compose.new.yml'
scp compose/php/Dockerfile lyc:~/typecho-php.Dockerfile
ssh lyc 'sudo install -m 644 ~/typecho-php.Dockerfile /data/software/compose/php/Dockerfile && /bin/rm -f ~/typecho-php.Dockerfile'
ssh lyc 'sudo docker compose -f /data/software/compose/docker-compose.yml config --quiet'
```

日常只更新目标服务，避免 API 或博客更新时重建数据库：

```bash
cd /data/software/compose
sudo docker compose -f docker-compose.yml ps
sudo docker compose -f docker-compose.yml up -d --no-deps --no-build nginx
sudo docker compose -f docker-compose.yml up -d --no-deps --build php
```

改 Nginx 配置后，先运行 `sudo docker exec nginx nginx -t`，通过后再运行 `sudo docker exec nginx nginx -s reload`。小饭桌 API 的构建、重启和日志命令见 [`../docs/CONTAINER_OPERATIONS.md`](../docs/CONTAINER_OPERATIONS.md)。
