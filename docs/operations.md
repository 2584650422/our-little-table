# 我们的时光线上运维

当前线上入口是 Traefik Gateway API，业务 Nginx、Typecho PHP 和小饭桌 API 运行在 K3s `homelab` 命名空间；Docker 只运行 MySQL。资源图、证书更新和完整回退步骤见 [K3s 线上部署手册](../server/k8s/README.md)。

## 检查状态和日志

在服务器上运行：

```bash
sudo kubectl get gatewayclass,gateway -A
sudo kubectl get httproute,pod,service -n homelab
sudo kubectl -n homelab logs deployment/our-time-api --tail=100
sudo kubectl -n homelab logs deployment/business-nginx --tail=100
sudo kubectl -n homelab logs deployment/typecho-php --tail=100
sudo docker ps --format '{{.Names}} {{.Status}}'
curl -fsS https://aaa.imlyc.cn/health
```

预期 API 的 `/health` 返回 `database: connected`，Docker 运行列表只有 `mysql`。用日志中的 `requestId` 关联请求。微信提醒可查 `wechat.subscribe_*`；图片上传失败可查 `cos.client_upload_failed`。不要把真实 `.env`、Secret 内容或完整环境变量贴入聊天或提交到 Git。

## 更新 API 配置

真实环境文件在 `/data/software/compose/our-time/server/.env`，权限 `600`。修改后同步到 K3s：

```bash
sudo bash /data/software/compose/our-time/server/k8s/sync-config.sh \
  /data/software/compose/our-time/server/.env 10.2.0.7 53306
sudo kubectl -n homelab rollout status deployment/our-time-api
curl -fsS https://aaa.imlyc.cn/health
```

脚本更新 ConfigMap/Secret 并滚动重启 API。更新程序代码时，先构建、推送并核对新镜像摘要，再修改 `server/k8s/api.yaml` 并应用；数据库结构变更须另行检查兼容性和备份。旧 `compose.production.yml` 保留作回退，不负责当前线上 API。

## 更新 Nginx、PHP 或证书

业务 Nginx 配置在 `server/k8s/nginx-sites.conf`。同步到服务器后，按 [K3s 手册](../server/k8s/README.md)更新 ConfigMap、滚动重启 Nginx，并运行 `nginx -t`。PHP 镜像固定摘要，更新时修改 `server/k8s/typecho-stack.yaml` 并检查首页和后台登录跳转。站点目录继续位于服务器 `/data/software/compose/nginx/html`；私有 `config.inc.php` 不进 Git。

服务器续期三个证书后运行 `server/k8s/sync-gateway-certs.sh`，把新证书写入 `kube-system` TLS Secret。公网证书由 Gateway 使用，业务 Nginx Pod 只接收集群内 HTTP。

## 数据和回退

当前库为 `our_time`；旧库 `little_table` 保留用于 015 回滚，不能当成当前业务库继续写入。回滚前必须检查新库是否已有新增记录，详见 [015 迁移手册](schema-refactor.md)。

MySQL 仍由公共 Compose 管理。生产备份保存在 `/data/software/compose/backups/`；恢复前核对备份时间、完整性和当前数据库版本。不要对已有生产库重导 `schema.sql`/`seed.sql` 或重复执行迁移，尤其是含删列操作的 `007`。整体回退命令见 [K3s 手册](../server/k8s/README.md)。

COS 链路仍是“小程序申请临时凭证 → 直接 PUT 到 COS”。若 API 已签发凭证而上传失败，先检查微信 request 合法域名、COS CORS 的 `PUT` 和请求头、Bucket/Region 以及 COS Request ID。

足迹照片保存时，后端还会对原图和预览图调用 COS `HeadObject` 校验元数据。服务器 `COS_SECRET_ID` 对应的 CAM 用户必须有 `name/cos:HeadObject`，资源仅需覆盖 `little-table/couples/*/travel-originals/*` 和 `little-table/couples/*/travel-previews/*`。缺少此动作时，直传可能成功，但照片记录会在元数据校验阶段失败；API 日志会显示 COS 403。无需给小程序临时上传凭证增加读取权限。
