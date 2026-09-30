# 后端配置指南

这份指南用于**本机首次运行**。生产服务器的目录、Compose 和更新命令见[部署说明](deployment.md)。先跑通数据库和登录，再按需配置图片上传与微信提醒。

## 1. 建库和准备环境文件

在仓库根目录，**只有全新数据库**才执行：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
cd server
cp .env.example .env
```

已有数据库不要重导这两个文件；按已执行记录补齐 `database/migrations/` 中尚未运行的脚本。所有实际密码只填在 `server/.env`，它被 Git 忽略。`server/.env.example` 是可提交的字段模板，不要在其中填真密钥。

本机 `app/config.py` 调用 `load_dotenv()` 加载 `.env`，再通过 `os.getenv()` 读取。生产容器则由 `compose.production.yml` 的 `env_file: .env` 注入环境变量。代码里找不到逐项引用 `.env` 文件名，是因为业务代码读取的是环境变量名。

## 2. 先填这些必需项

| 变量 | 怎么填 |
| --- | --- |
| `MYSQL_HOST` / `MYSQL_PORT` | 本机数据库通常是 `127.0.0.1:3306`；容器内连接同网络的 MySQL 使用服务名 `mysql` |
| `MYSQL_DATABASE` | 默认 `little_table`，与建库脚本一致 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | 有该库权限的账号；本机初始化可用 root，生产建议专用账号 |
| `JWT_SECRET` | 至少 32 字节随机值，可用 `openssl rand -hex 32` 生成 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 真正使用 `wx.login` 时填写，与小程序后台和项目 AppID 对应；AppSecret 只留后端 |

容器里的 `127.0.0.1` 指容器自己，不是宿主机。`PORT` 默认 3000；`JWT_EXPIRES_IN` 默认 `7d`。本机只想测试后端时，可明确开启 `DEV_LOGIN_ENABLED=true` 使用开发登录接口；生产 Compose 强制关闭它。

## 3. 启动和验证

在 `server/` 目录：

```bash
make install
make dev
```

另开终端：

```bash
curl http://127.0.0.1:3000/health
make check
make test
```

`/health` 返回 `database: connected` 才表示数据库可用；若是 503，先查 MySQL 是否启动、账号密码和 `MYSQL_HOST`。服务日志输出到终端；生产环境用 `docker compose logs` 查看，参见[容器运维](operations.md)。改本机 `.env` 后重启 Uvicorn；改生产 `.env` 后重建 API 容器。

前端 API 地址在 `miniprogram/config/index.js`。微信开发者工具打开 `miniprogram/`，本地调试可临时关闭合法域名校验；真机不能用 `127.0.0.1` 访问电脑，正式版要使用微信后台登记的 HTTPS 域名。

## 4. 按需开启微信提醒

在微信后台选用“做饭提醒”和“做饭完成提醒”，然后在服务端 `.env` 填入两个模板 ID 及字段键。模板 ID 不写入小程序代码或 Git。当前字段对应关系、一次性订阅的 10 次预计余额上限和真机测试步骤都在[消息通知](notifications.md)。未配置时，小程序内消息仍可使用。

常用变量包括 `WECHAT_ORDER_TEMPLATE_ID`、`WECHAT_SERVED_TEMPLATE_ID`、`WECHAT_TEMPLATE_USER_KEY`、`WECHAT_TEMPLATE_DISH_KEY`、`WECHAT_TEMPLATE_MESSAGE_KEY`、`WECHAT_SERVED_USER_KEY`、`WECHAT_SERVED_DISH_NAME_KEY`。字段键以自己微信后台选用模板的详情为准，不要猜编号。

## 5. 按需开启 COS 图片

设置 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`（带数字 APPID 后缀）和 `COS_REGION`（如 `ap-shanghai`）。私有桶通常让 `COS_BASE_URL` 留空；`COS_KEY_PREFIX` 默认 `little-table`。小程序向 API 获取短期凭证后直接 PUT 到 COS，永久密钥只在后端。微信后台的 **request 合法域名**需包含 COS 实际上传域名，COS CORS 需允许 `PUT` 和请求头 `Authorization`、`x-cos-security-token`、`Content-Type`。图片大小与裁切规则见[图片规范](image-policy.md)。

## 常见问题

| 现象 | 先检查 |
| --- | --- |
| `/health` 返回 503 | MySQL 服务、Host/Port、账号密码、库是否建好 |
| 小程序登录失败 | AppID 与 AppSecret 是否匹配、前端 API 地址和合法域名 |
| 点菜正常但没有微信提醒 | 接收人是否授权、预计余额是否足够、模板字段、`wechat.subscribe_*` 日志 |
| API 签发上传凭证，但照片上传失败 | 微信 request 域名、COS CORS、Bucket/Region；见[容器运维](operations.md) |
| 改了 `.env` 仍读旧值 | 本机重启进程；生产用 `up -d --force-recreate api` |

不要把 `.env`、AppSecret、数据库密码、COS 密钥、生产 token 或日志中的敏感值贴进聊天和提交记录。
