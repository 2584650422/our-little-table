# Typecho PHP-FPM

镜像为 `typecho-php:7.4`，容器名为 `typecho-php`。Dockerfile 保存在本目录，服务器对应目录为 `/data/software/compose/php/`；容器由 `/data/software/compose/docker-compose.yml` 统一管理。Typecho 程序文件和私有 `config.inc.php` 仍保存在服务器。

```bash
cd /data/software/compose
sudo docker compose -f docker-compose.yml build php
sudo docker compose -f docker-compose.yml up -d --no-deps --no-build php
sudo docker compose -f docker-compose.yml logs --tail=100 php
```

镜像基于 `php:7.4.33-fpm-bullseye`，安装 `mysqli`、`pdo_mysql` 和 `opcache`。PHP-FPM 仅在 Docker 网络内供 Nginx 访问，不发布宿主机端口。
