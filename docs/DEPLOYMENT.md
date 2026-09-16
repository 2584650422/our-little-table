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

全新安装不要执行这些迁移，因为最新 `schema.sql` 已包含相应字段和索引。旧库应严格按编号执行；`002` 增加饭桌级首页主副标题，`003` 将初始化模板与真实饭桌菜单分表并收紧 `couple_id` 非空约束，`004` 增加饭桌稳定 UUID 和可保留多张饭桌关联的成员表，`005` 为私有 COS 增加 Object Key 字段。

生产环境建议为 `little_table` 单独创建只拥有该库 DML 权限的用户，不要让应用使用 root。

## 2. 后端环境变量

```bash
cd server
cp .env.example .env
```

首次测试不需要一次填完所有集成。每个字段的来源、示例、必填阶段、验证命令和故障排查见 [`CONFIGURATION_GUIDE.md`](CONFIGURATION_GUIDE.md)。`JWT_SECRET` 请使用至少 32 字节的随机值。微信订阅模板的字段键必须逐项从模板详情复制到四个 `WECHAT_TEMPLATE_*_KEY`，代码不会猜测模板字段。

## 3. 本地启动

```bash
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

依赖已安装后，可用 `make dev` 代替最后一条命令；部署时用 `make start`。

访问 `http://127.0.0.1:3000/health` 检查数据库连接。微信开发者工具应打开 `food_project/miniprogram`。本地调试时，把 `miniprogram/config/index.js` 的 `apiBaseUrl` 改为本机可访问地址；仅本地开发可暂时关闭“校验合法域名”。真机不能用 `127.0.0.1` 指向电脑。

应用只向 stdout/stderr 输出日志。本地使用 Uvicorn 直接查看，或用以下命令保存到 `server/logs/dev.log`：`mkdir -p logs && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000 2>&1 | tee -a logs/dev.log`。生产 PID、重启和日志轮转交给 Docker、systemd、Supervisor 或云平台。详细说明见 [`CONFIGURATION_GUIDE.md`](CONFIGURATION_GUIDE.md#十服务端日志进程与请求追踪)。

## 4. Docker

```bash
cd server
docker build -t little-table-api .
docker run -d --name little-table-api --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3000:3000 little-table-api
```

MySQL 使用已有实例，因此项目不强制提供或启动新的 MySQL 容器。

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

- `request 合法域名`：`https://api.example.com` 以及 `https://<Bucket>.cos.<Region>.myqcloud.com`。后者用于以 `wx.request + PUT` 安全直传 COS。
- `uploadFile 合法域名`：当前架构不需要；小程序的 `wx.uploadFile` 只适合 multipart POST，而本项目使用 COS `PutObject`。
- `downloadFile 合法域名`：COS 图片实际访问域名；若绑定了 CDN/自定义域名则填写该域名。

在后端 `.env` 填 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。AppSecret 绝不能放进小程序目录。

订阅消息需在“功能 → 订阅消息”选择适合的点菜/待办类模板，将真实 Template ID 同时填入：

- 服务端 `.env` 的 `WECHAT_ORDER_TEMPLATE_ID`；
- 小程序 `miniprogram/config/index.js` 的 `wechatOrderTemplateId`（Template ID 可公开，用于拉起授权）。

再把模板详情中的四个真实字段键填入服务端 `WECHAT_TEMPLATE_MEAL_KEY`、`WECHAT_TEMPLATE_DISH_KEY`、`WECHAT_TEMPLATE_MESSAGE_KEY`、`WECHAT_TEMPLATE_DATE_KEY`。若模板字段类型/长度不同，需要同步调整 `server/app/main.py` 的值格式。用户必须主动点击“开启点菜提醒”授权；一次性订阅通常一次授权对应一次下发机会。

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
