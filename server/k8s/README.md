# K3s 线上部署手册

当前入口由 K3s 内置 Traefik 实现 Gateway API。`Gateway` 在 `kube-system`，四个域名通过 `HTTPRoute` 进入 `homelab/business-nginx`；这个 Nginx Pod 分别代理我们的时光 API、Typecho PHP 和宿主机的 `allinssl:35105`。API、Nginx、PHP 都使用 ClusterIP Service。MySQL 仍在 Docker，Docker 中其他容器已停止。

```text
公网 80/443 → Traefik Gateway → business-nginx Service/Pod
                                  ├─ aaa.imlyc.cn → our-time-api Service/Pod
                                  ├─ imlyc.cn / www.imlyc.cn → typecho-php Service/Pod
                                  └─ ssl.imlyc.cn → 10.2.0.7:35105 (allinssl)
Typecho 的 mysql:3306 → homelab/mysql Service → 10.2.0.7:53306 (Docker MySQL)
```

## 文件和私有数据

- `traefik-gateway-config.yaml`：K3s `HelmChartConfig`，启用 Traefik 的 Gateway provider，配置 HTTP/HTTPS listener，并将 Traefik Service 的 `externalTrafficPolicy` 设为 `Local` 以保留访客 IP。服务器另存于 `/var/lib/rancher/k3s/server/manifests/traefik-gateway-config.yaml`，由 K3s 自动管理；以后增加节点时，入口节点上也必须有就绪的 Traefik Pod。
- `gateway-routes.yaml`：HTTPS 到业务 Nginx、HTTP 跳 HTTPS。Gateway API CRD 已由 K3s 的 `traefik-crd` Chart 安装。
- `typecho-stack.yaml`：Typecho PHP、ClusterIP Service，以及指向 Docker MySQL 的 selectorless Service/EndpointSlice。PHP 继续读取服务器上的私有 `config.inc.php`，无需改数据库地址。
- `nginx-sites.conf`、`nginx.yaml`：业务 Nginx 配置、Deployment 和 ClusterIP Service。Typecho 站点目录仍在 `/data/software/compose/nginx/html`，由单节点 Pod 以 hostPath 挂载；更换节点前须先迁移这些文件和 PHP 私有配置。
- `api.yaml`、`sync-config.sh`：我们的时光 API 和配置同步。真实 `/data/software/compose/our-time/server/.env`、镜像拉取凭据和 TLS 私钥只在服务器/Kubernetes Secret 中，不进 Git。K3s Secret 静态加密目前尚未启用。

服务器副本位于 `/data/software/compose/our-time/server/k8s/`。Nginx 和 PHP 镜像固定到摘要，避免标签移动。Docker Compose 文件保留作回退，不再承担线上流量。

Docker MySQL 目前仍监听宿主机 `0.0.0.0:53306`；K3s 通过节点内网地址访问它。从当前 Mac 连接服务器公网 IP 的 `53306` 已成功，是否向其他公网地址开放需核对云安全组；确认远程管理需求后，应只允许确有需要的来源连接该端口。

## 日常检查

```bash
sudo kubectl get gatewayclass,gateway -A
sudo kubectl get httproute,pod,service -n homelab
sudo kubectl get pods -n kube-system | grep traefik
sudo docker ps --format '{{.Names}} {{.Status}}'  # 预期仅 mysql
curl -fsS https://aaa.imlyc.cn/health
curl -I https://imlyc.cn/
```

`aaa.imlyc.cn/health` 应返回 `database: connected`，`imlyc.cn` 首页应返回 200。Typecho 后台入口 `/admin/` 应跳到登录页。`ssl.imlyc.cn` 当前上游 `allinssl` 对根路径返回 404，直连 `10.2.0.7:35105/` 也是 404；这不是 Gateway 或 Nginx 产生的错误。

## 更新配置

修改服务器 `.env` 后，继续用 `sync-config.sh` 同步到 K3s；它会更新 Secret/ConfigMap 并滚动重启 API：

```bash
sudo bash /data/software/compose/our-time/server/k8s/sync-config.sh \
  /data/software/compose/our-time/server/.env 10.2.0.7 53306
```

修改 `nginx-sites.conf` 后，同步文件到服务器，更新 ConfigMap 并重启 Nginx Pod：

```bash
sudo kubectl -n homelab create configmap business-nginx-config \
  --from-file=sites.conf=/data/software/compose/our-time/server/k8s/nginx-sites.conf \
  --dry-run=client -o yaml | sudo kubectl apply -f -
sudo kubectl -n homelab rollout restart deployment/business-nginx
sudo kubectl -n homelab rollout status deployment/business-nginx
sudo kubectl -n homelab exec deployment/business-nginx -- nginx -t
```

续期服务器上的证书后，运行 `sudo bash /data/software/compose/our-time/server/k8s/sync-gateway-certs.sh`，更新 `kube-system` 中的三个 TLS Secret，再检查三个 HTTPS 域名的证书。现用证书到期时间为 **2026-12-16 UTC**。更换节点 IP 或 MySQL 端口时，同时更新 `typecho-stack.yaml` 的 EndpointSlice、`nginx-sites.conf` 的 `allinssl` 地址和 API 配置同步参数。

## 回退

服务改名的回滚入口见 [服务命名迁移](../../docs/service-names.md)。它恢复旧服务资源和 Nginx 路由，数据库仍使用当前 our_time。

数据库 015 的回滚须单独核对新增数据，见 [数据库迁移](../../docs/schema-refactor.md)。不能直接启动迁移前留存的旧 Docker API 容器：其源码和数据库结构可能已不兼容。若需撤回整个 K3s 入口，要另行准备匹配当前数据库的 Compose 镜像、证书和 Nginx 配置，不能把历史容器直接当成当前回退方案。

`helm-install-traefik*` 是 K3s 的安装 Job，`Completed` 状态正常。
