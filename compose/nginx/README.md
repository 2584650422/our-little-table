# Nginx（线上容器）

容器名为 `nginx`，对外监听 80 和 443。它由 `/data/software/compose/docker-compose.yml` 与 MySQL、Typecho PHP 一起管理；站点配置、证书、网页文件和日志仍挂载自服务器的 `nginx/` 目录。

```bash
cd /data/software/compose
sudo docker compose -f docker-compose.yml ps nginx
sudo docker exec nginx nginx -t
sudo docker exec nginx nginx -s reload
sudo docker compose -f docker-compose.yml logs --tail=100 nginx
```

Nginx 通过 `compose_blog-network` 访问 `typecho-php:9000` 和小饭桌 API。不要把证书或私有站点文件提交到小饭桌仓库。
