# 云端项目和服务名称

2026-11-05 完成名称迁移，业务后端版本仍为 20261105-02；本次仅调整资源名称、镜像仓库、目录和上游转发。

| 对象 | 当前名称 |
|---|---|
| 项目目录 | `/data/software/compose/our-time` |
| API Deployment / Service | `homelab/our-time-api` |
| 运行配置 / 应用密钥 | `our-time-config` / `our-time-secrets` |
| 应用镜像拉取凭据 | `our-time-acr` |
| 镜像仓库 | `crpi-6okhrwjmx6tg1zpc.cn-beijing.personal.cr.aliyuncs.com/docker-images-lyc/our-time-api` |
| 当前数据库 | `our_time` |
| API 域名 | `https://aaa.imlyc.cn` |

旧 `/data/software/compose/little-table` 仅为兼容符号链接；旧镜像保留用于回滚。Typecho 共用的旧镜像拉取凭据也保留，不属于仍在运行的旧 API。COS 前缀不随项目目录改名。

## 检查和更新

```bash
sudo kubectl -n homelab get deployment,pod,service
sudo kubectl -n homelab logs deployment/our-time-api --tail=50
curl -fsS https://aaa.imlyc.cn/health
sudo bash /data/software/compose/our-time/server/k8s/sync-config.sh \
  /data/software/compose/our-time/server/.env 10.2.0.7 53306
```

后续镜像推送至新仓库，K3s YAML 继续引用已核验的 sha256 摘要。

## 仅回退服务名称

私有备份包含可恢复的旧资源、Nginx 配置和脚本，权限限制在服务器上，不进 Git：

```bash
sudo bash /data/software/compose/backups/our-time-service-rename-20261105/rollback.sh
```

脚本先恢复旧名称的 API 和当前数据库配置，等其就绪，再恢复 Nginx 上游并平滑 reload，最后停止新名称的 API；不回退数据库，也不丢弃新增记录。项目新目录继续有效，旧路径兼容链接仍可访问。

数据库结构回滚使用 [015 专用步骤](schema-refactor.md)，其中脚本已同步当前服务名。若先回退了服务名称，再进行数据库回滚，须对应改用实际运行的 Deployment/ConfigMap 名称。不要同时运行两类回滚。

本次未实际执行生产命名回滚；已保存完整恢复资源并检查脚本语法。当前服务切换及业务读取已验证。
