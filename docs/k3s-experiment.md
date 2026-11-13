# k3s 接入试验记录（已回退）

这份文档只记录 2026-10-09 的一次学习试验及当时的回退，**不是当前生产部署方案**。当前部署见 [部署说明](deployment.md) 和 [K3s 线上部署手册](../server/k8s/README.md)。

## 当时怎样接入

- 在已有的 `homelab` 命名空间中创建一个 API Deployment 和一个 NodePort Service，将阿里云镜像固定到具体 digest，避免 `latest` 后续移动造成版本不明确。
- 把服务器原有的 `server/.env` 制成 Kubernetes Secret，以只读文件挂载到容器的 `/app/.env`。镜像仓库登录信息另建 Secret，供 k3s 拉取私有镜像；两者都没有写进 Git。
- Pod 通过节点内网地址 `10.2.0.7:53306` 访问仍由 Docker Compose 运行的 MySQL。Nginx 暂时代理到 `host.docker.internal:31030`，即从 Nginx 容器访问宿主机上的 NodePort。
- 健康检查返回 `database: connected`，公网 HTTPS 地址在旧 Compose API 停止后仍可访问。复核时发现当时 `.env` 的 `NODE_ENV` 是 `development`，因此在试验 YAML 中将它覆盖为 `production`。回退后也已将服务器 `.env` 和正式 Compose 配置统一改为 `production`。

`host.docker.internal` 由公共 Compose 给 Nginx 容器配置的 `host-gateway` 映射提供，用于找到宿主机；它并不代替 Kubernetes Service，也不会自动适配 NodePort 或数据库地址的变化。试验中的 NodePort 没有对公网放行。

## 回退结果

已重新启动原 Compose API，确认容器 `running healthy`，并将 Nginx 恢复到 `little-table-api:3000`。从外部访问 `https://aaa.imlyc.cn/health` 再次返回 `database: connected`。试验创建的 API Deployment、Service 和两个 Secret，以及服务器上复制的试验 YAML，均已清理；原有的 `homelab` 命名空间保留。

今后若再练习 k3s，需要重新创建 Secret 和 Deployment，不要把本试验的地址、端口或镜像 digest 当作长期配置。Kubernetes Secret 的 `data` 在 YAML 中显示为 Base64 编码，并非加密；当时使用的 `.env` 文件挂载带有 `subPath`，更新 Secret 后还需重建 Pod 才会读取新内容。
