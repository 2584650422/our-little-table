> 当前数据库为 `our_time`，旧库 `little_table` 暂留作 015 回滚来源。改名与回滚步骤见 [数据库迁移](schema-refactor.md)。

# 部署说明

生产入口是 K3s 内置 Traefik 的 Gateway API；小饭桌 API、业务 Nginx 和 Typecho PHP 都运行在 K3s 中，通过 ClusterIP Service 通信。MySQL 5.7.44 仍由服务器公共 Docker Compose 运行。详细资源、检查和回退命令见 [K3s 线上部署手册](../server/k8s/README.md)。小程序前端由微信开发者工具上传、审核并发布。

## 首次准备

1. 确认 Docker MySQL 和 `our_time` 数据库正常。全新数据库可导入 `database/schema.sql` 和 `database/seed.sql`；已有数据库**不要**重导，先核对迁移记录，只运行尚未执行的脚本。`007_remove_category_icons.sql` 会删除旧列，执行前要有可验证的备份。
2. API 的真实 `.env` 保存在服务器 `/data/software/compose/our-time/server/.env`，权限 `600`，不上传到 Git。用 `server/k8s/sync-config.sh` 将普通配置和密钥分别同步为 ConfigMap/Secret；数据库地址是 `10.2.0.7:53306`。
3. Gateway 统一处理 80/443 和证书；业务 Nginx Pod 处理三个站点的内部转发。Typecho 站点文件和 PHP 私有配置仍在服务器目录，两个 Pod 挂载这些文件。各资源清单位于 `server/k8s/`。

镜像构建、数据库迁移、后端切换、前端上传的完整顺序见[版本发布说明](releasing.md)。

## 更新 API 配置与检查

在服务器运行：

```bash
sudo bash /data/software/compose/our-time/server/k8s/sync-config.sh \
  /data/software/compose/our-time/server/.env 10.2.0.7 53306
sudo kubectl -n homelab rollout status deployment/our-time-api
curl -fsS https://aaa.imlyc.cn/health
```

预期 `/health` 返回 `database: connected`。更新 API 镜像时，先推送并固定新摘要，再修改 `server/k8s/api.yaml` 中的镜像地址并 `kubectl apply`；修改 `.env` 只需运行上面的同步脚本。查看日志、排错、备份和回退见[容器运维](operations.md)。

2026-11-13：后端 `20261113-01` 已在服务器构建、推送并部署；清单中固定了实际镜像摘要。上线后健康检查显示数据库已连接，“想你”接口的未登录请求返回 401。微信“想你”订阅消息已配置为“每日问候提醒”，字段顺序为：问候语 `thing1`（发送者称呼）、今日问候内容 `thing2`（留言正文）。实际模板 ID 仅保存在服务器环境文件，已同步 Kubernetes 配置并完成后端滚动重启，健康检查通过。双人真机送达尚未验收；站内提醒与微信通知应分别验证。

## 发布小程序

1. 将 `miniprogram/config/index.js` 指向正式 HTTPS API 地址，确认 `miniprogram/project.config.json` 的 AppID 正确。
2. 在微信小程序后台登记 API 的 request 合法域名。COS 直传还需将实际 COS 域名登记为 request 合法域名；图片读取域名按使用方式登记为 downloadFile 合法域名，并正确配置 COS CORS。AppSecret、COS 永久密钥和微信模板 ID 只放后端。
3. 如需验证前端更新提示，上传前更新 `miniprogram/services/updates.js` 的 `BUILD_ID`；在仓库根目录的终端运行 `node --test tests/miniprogram-update.test.js` 可检查更新逻辑。上传代码、提交审核、审核通过和**点击发布**是不同阶段，普通入口只有正式发布后才可能取得新代码。
4. 用两位成员的真机完成登录、创建/加入、点菜、上菜、历史记录、图片上传和通知验证。站内消息和微信订阅消息应分别检查；`/health` 不能证明微信消息送达。

微信新包由客户端检查和下载。**旧代码若尚未包含更新监听功能，它无法显示新版弹窗**；这类设备首次更新可能要完全关闭并重新进入小程序。即使已有更新监听，微信仍决定新包何时可下载；重新打开、清空 Storage 或 `wx.reLaunch` 不能强制取得新代码。用户可在“我们 → 版本与更新”查看当前渠道、包标识和更新状态。体验版/预览版要用各自二维码验证，不等同于电脑普通入口的正式版。

## 数据与密钥放在哪里

- 业务库由公共 MySQL 容器保存；备份只在服务器 `/data/software/compose/backups/`，不进入 Git。
- 公共 Compose 的 `/data/software/compose/.env` 提供 `MYSQL_ROOT_PASSWORD`，由 Docker Compose 展开 `${MYSQL_ROOT_PASSWORD}`；它**不是** API 的环境文件。
- API 的服务器 `.env` 经 `sync-config.sh` 写入 K3s ConfigMap/Secret。后端仍用 `os.getenv()` 读取变量。Typecho 的私有 `config.inc.php` 仍只留服务器，并以只读文件挂载进 PHP Pod。
- Nginx 证书、站点文件、数据库数据和其他私有配置均由服务器另行管理，不放在小饭桌仓库。证书续期后需同步 K3s TLS Secret。


## 2026-11-13 16:34 想念测试接口修正

- 生产后端已更新至 `20261113-02`，摘要 `sha256:fef7bf66d648413bc1136fdcc4c7823e642a890ca9c67cf719299b5b2c686be9`；Deployment 1/1 可用，健康检查数据库 connected。
- 旧版本 test-send 只接受 created/served，导致新版前端测试 thought 报“测试提醒类型无效”；新接口已支持 thought。以生产容器内的隔离 HTTP 请求验证通过，微信发送已 mock，没有发出真实通知。
- 消息提醒页新增每类单独“补充”按钮，可直接申请想念模板；补充结果展示实际增加的类别。前端需重新编译/预览后才能看到该按钮，不需要先正式发布。
- 通知后端回归 7 项、消息同步与想你前端回归共 10 项通过；WXML/WXSS 编译通过。真实微信送达仍待双方真机验收。


## 2026-11-13 日历当天记录添加时间

当天记录在记录人后显示实际创建时间，格式为“某某记录 · YYYY-MM-DD HH:mm”，使用数据库保存的北京时间。补写过去日子的记录仍显示实际添加时间，编辑不修改原创建时间。接口新增createdAt字段，复用calendar_entries.created_at，无数据库迁移；旧接口未提供时间时前端隐藏时间部分。相关前端12项、后端16项检查及WXML/WXSS编译通过。后端版本20261113-03，摘要sha256:a997c8752b2848e64b69ca0bd4270ced5d89b6cf6e88f36ffdb8d9abf071859e；前端需重新编译/预览。
