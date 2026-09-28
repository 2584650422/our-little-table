# 部署说明

## 1. 初始化 MySQL

要求 MySQL 8.0+。在有建库权限的账号下执行：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

旧版数据库升级到“饭桌私有分类和可编辑示例菜”时，再执行一次：

```bash
mysql -u root -p little_table < database/migrations/001_couple_owned_categories.sql
mysql -u root -p little_table < database/migrations/002_couple_home_copy.sql
mysql -u root -p little_table < database/migrations/003_separate_starter_menu.sql
mysql -u root -p little_table < database/migrations/004_couple_memberships.sql
mysql -u root -p little_table < database/migrations/005_private_cos_object_keys.sql
```

全新安装不要执行这些迁移，因为最新 `schema.sql` 已包含相应字段和索引。旧库应严格按编号执行；`002` 增加饭桌级首页主副标题，`003` 将初始化模板与真实饭桌菜单分表并收紧 `couple_id` 非空约束，`004` 增加饭桌稳定 UUID 和可保留多张饭桌关联的成员表，`005` 为私有 COS 增加 Object Key 字段，`008` 记录微信一次性订阅授权机会，`009` 将每位用户每个模板的预计可用次数限制为 10 次。

生产环境建议为 `little_table` 单独创建只拥有该库 DML 权限的用户，不要让应用使用 root。

## 2. 后端环境变量

```bash
cd server
cp .env.example .env
```

首次测试不需要一次填完所有集成。每个字段的来源、示例、必填阶段、验证命令和故障排查见 [`CONFIGURATION_GUIDE.md`](CONFIGURATION_GUIDE.md)。`JWT_SECRET` 请使用至少 32 字节的随机值。微信订阅模板的字段键必须逐项按后台模板详情配置。

## 3. 本地启动

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

依赖已安装后，可用 `make dev` 代替最后一条命令；部署时用 `make start`。

访问 `http://127.0.0.1:3000/health` 检查数据库连接。微信开发者工具应打开 `food_project/miniprogram`。本地调试时，把 `miniprogram/config/index.js` 的 `apiBaseUrl` 改为本机可访问地址；仅本地开发可暂时关闭“校验合法域名”。真机不能用 `127.0.0.1` 指向电脑。

小程序通过微信 `UpdateManager` 监听检查结果、下载完成和下载失败。下载就绪后提示重启；在后台就绪、弹窗显示失败或用户选择稍后更新时，下次进入会再次提示。`applyUpdate()` 仅在收到下载就绪回调后调用，切换代码包时保留登录状态和已保存的未提交菜单；正在编辑且尚未保存的表单需先自行保存。

“我们 → 版本与更新”在未加入饭桌和 API 请求失败时也可使用，显示正式版/体验版/开发预览版、微信返回的版本号、代码包标识和本次更新状态。下载未就绪时，手动“重新打开”调用 `wx.restartMiniProgram`；客户端缺少接口或重启失败时提供完全关闭并重新进入的指引。重启不保证立刻得到新包，是否有新版与下载进度由微信负责，`wx.reLaunch` 和清空 Storage 都无法替换小程序代码包。[微信官方更新 API 说明](https://developers.weixin.qq.com/miniprogram/dev/api/base/update/UpdateManager.html)

每次上传前更新 `miniprogram/services/updates.js` 的 `BUILD_ID`，以便确认实际加载的代码。上传、提交审核、审核通过和正式发布是不同阶段：电脑端普通入口使用正式版，手机扫码预览不会更新电脑正式版；请在微信后台版本管理中确认已正式发布。体验/预览版使用最新二维码验证；更新弹窗可在开发者工具“下次编译模拟更新”中验证，再用已包含更新监听代码的正式旧版升级到下一正式版测试。早于更新监听功能的旧包无法执行新版弹窗代码，首次需完全关闭小程序再从微信重新打开（电脑端必要时退出并重新登录微信）。

本地更新流程回归检查：仓库根目录执行 `node --test tests/miniprogram-update.test.js`，覆盖后台就绪、延后更新、弹窗失败、下载过程中弹窗竞态和客户端降级。

应用只向 stdout/stderr 输出日志。本地使用 Uvicorn 直接查看，或用以下命令保存到 `server/logs/dev.log`：`mkdir -p logs && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000 2>&1 | tee -a logs/dev.log`。生产 PID、重启和日志轮转交给 Docker、systemd、Supervisor 或云平台。详细说明见 [`CONFIGURATION_GUIDE.md`](CONFIGURATION_GUIDE.md#十服务端日志进程与请求追踪)。

## 4. Docker

```bash
cd server
docker build -t little-table-api .
docker run -d --name little-table-api --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 little-table-api
```

MySQL 使用已有实例，因此项目不强制提供或启动新的 MySQL 容器。

### 使用现有 Nginx / MySQL Compose 网络部署

如果服务器已有 `compose_blog-network` 网络，并且数据库容器在该网络中的服务名为 `mysql`，可将 `server/` 上传到服务器的 `server/` 目录，并将真实环境文件单独放到 `server/.env`（权限设为 `600`）。随后执行：

```bash
cd /data/software/little-table/server
docker compose -f compose.production.yml up -d --build
docker compose -f compose.production.yml ps
docker compose -f compose.production.yml logs --tail=100 api
```

此 Compose 不发布数据库端口或后端端口到公网；Nginx 与 API 通过 `compose_blog-network` 通信，API 通过网络别名 `mysql:3306` 连接现有 MySQL。生产 Compose 会强制关闭 `DEV_LOGIN_ENABLED`。

`server/little-table.nginx.conf` 是独立的反向代理配置样例。新增或替换服务器上的 Nginx 配置前，先备份原配置、运行 `nginx -t`，通过后再 reload。切换现有域名会改变该域名原先承载的网站内容。

服务器首次部署、更新、查看日志、排错、回滚和环境变量变更的完整流程见 [`CONTAINER_OPERATIONS.md`](CONTAINER_OPERATIONS.md)。

## 5. Nginx HTTPS 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    client_max_body_size 512k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
```

上传图片由客户端直传 COS，不经过 Nginx。小程序拒绝超过 10MB 的原图，并自动压缩；`COS_UPLOAD_MAX_MB` 默认限制最终上传文件为 2MB。

## 6. 微信公众平台

在“小程序后台 → 开发管理 → 开发设置 → 服务器域名”配置：

- `request 合法域名`：部署后的 HTTPS API 域名（当前服务器可使用 `https://aaa.imlyc.cn`）以及 `https://<Bucket>.cos.<Region>.myqcloud.com`。后者用于以 `wx.request + PUT` 安全直传 COS。
- `uploadFile 合法域名`：当前架构不需要；小程序的 `wx.uploadFile` 只适合 multipart POST，而本项目使用 COS `PutObject`。
- `downloadFile 合法域名`：COS 图片实际访问域名；若绑定了 CDN/自定义域名则填写该域名。

在后端 `.env` 填 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。AppSecret 绝不能放进小程序目录。

订阅消息使用“做饭提醒”和“做饭完成提醒”。服务端 `.env` 填两个 Template ID 和各自真实字段键；详见 [消息通知配置](NOTIFICATIONS.md)。前端从后端读取公开的 Template ID，不再需要写入小程序配置。页面中的剩余次数是预计值。未配置或微信发送失败时，下单、上菜和站内提醒照常工作。

数据库升级分两步：先执行 `database/migrations/006_couple_background.sql`（只加列，可在旧后端运行时做）；部署并验证新版 Python API 后再备份数据库、执行 `database/migrations/007_remove_category_icons.sql`（删列，不可在旧后端运行时提前执行）。详见 [容器运维](CONTAINER_OPERATIONS.md)。

启用微信订阅次数记录时，按顺序执行尚未运行的 `008_wechat_subscription_credits.sql` 和 `009_cap_wechat_subscription_credits.sql`，再发布读取这些表的 API。`008` 新增授权及次数表；`009` 将已有余额收敛到每用户、每模板最多 10 次。全新安装的 `database/schema.sql` 已包含表结构，不需要执行这两项迁移。已迁移过的库不要重复运行。

## 7. 腾讯云 COS

后端 `.env` 填写：

- `COS_SECRET_ID` / `COS_SECRET_KEY`：仅服务端可见，建议使用仅能签发目标 Bucket 上传权限的子账号。
- `COS_BUCKET`：必须是完整 Bucket 名（含 APPID 后缀）。
- `COS_REGION`：如 `ap-shanghai`。
- `COS_BASE_URL`：私有桶一般留空。它只用于兼容历史公开图片，不是 API 域名，也不是上传地址。
- `COS_KEY_PREFIX=little-table`：所有对象的顶层前缀；COS 不需要手动创建文件夹。
- `COS_SIGNED_URL_EXPIRES_SECONDS=600`：私有图片临时读取链接的有效期。

Bucket 保持私有读写。CORS 方法包含 `PUT`，请求头允许 `Authorization`、`x-cos-security-token` 和 `Content-Type`。服务端 STS 策略只授予当前饭桌下单个随机 Object Key 的 `PutObject`，有效期 15 分钟；数据库只保存 Key，读图时由 API 按请求临时签名。

## 8. 发布前检查

1. 将 `miniprogram/config/index.js` 的 `apiBaseUrl` 改成正式 HTTPS 域名。
2. 保持 `miniprogram/project.config.json` 中现有 AppID，不把 `.env` 上传版本库。
3. 运行 `.venv/bin/python -m compileall -q app`，访问 `/health`。
4. 用两个微信账号完成创建/加入、提交、状态流转、历史、再次点菜测试。
5. 在真机验证 COS 上传、图片读取与订阅消息；未配置时主流程仍正常，仅显示友好提示。
