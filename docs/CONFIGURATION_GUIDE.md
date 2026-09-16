# 首次测试环境变量配置指南

这份文档回答两个问题：第一次测试到底要填什么，以及每个值应该去哪里找。

## 一、先看结论

配置不需要一次全部完成。建议分五个阶段测试：

| 测试阶段 | 必填配置 | 可以继续留空 |
| --- | --- | --- |
| 后端启动和数据库健康检查 | MySQL 六项、`JWT_SECRET` | 微信、COS、订阅消息 |
| 后端 API 冒烟测试，不打开小程序 | 上一项，加 `DEV_LOGIN_ENABLED=true` | 微信、COS、订阅消息 |
| 微信开发者工具跑通核心闭环 | MySQL、JWT、`WECHAT_APP_ID`、`WECHAT_APP_SECRET` | COS、订阅消息 |
| 测试菜品图片上传和显示 | 上一项，加全部 COS 配置 | 订阅消息 |
| 测试微信消息送达 | 上一项，加 Template ID 和四个模板字段键 | 无 |

因此，第一次打开小程序并测试“登录 → 创建饭桌 → 菜单 → 收藏 → 点菜 → 状态 → 历史”时，推荐先填：

```ini
NODE_ENV=development
PORT=3000
JWT_SECRET=<自己生成的随机字符串>

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=little_table
MYSQL_USER=root
MYSQL_PASSWORD=<本机 MySQL root 的真实密码>
MYSQL_CONNECTION_LIMIT=10

WECHAT_APP_ID=wx1e35ad5c79849fc0
WECHAT_APP_SECRET=<微信小程序后台的 AppSecret>

WECHAT_ORDER_TEMPLATE_ID=
WECHAT_ORDER_PAGE=pages/orders/orders
WECHAT_TEMPLATE_MEAL_KEY=
WECHAT_TEMPLATE_DISH_KEY=
WECHAT_TEMPLATE_MESSAGE_KEY=
WECHAT_TEMPLATE_DATE_KEY=

COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=
COS_BASE_URL=
COS_UPLOAD_MAX_MB=5
```

这时图片上传会提示“图片上传暂未配置”，微信提醒会提示“微信提醒暂未配置”，但核心点菜流程可以正常工作，菜品没有图片时会显示统一占位图。

## 二、创建真正使用的 `.env`

模板文件是：

```text
server/.env.example
```

不要直接把真实密码写进模板，而是复制一份本地配置：

```bash
cd /Users/yc/Desktop/food_project/server
cp .env.example .env
```

然后只编辑 `server/.env`。项目根目录的 `.gitignore` 已忽略 `.env`，但提交代码前仍应运行一次：

```bash
git status --short
```

确保没有真实密钥被纳入版本控制。不要把 `.env` 发到聊天群、截图上传工单或粘贴到前端代码。

## 三、MySQL 配置：首次启动必填

### `MYSQL_HOST`

填写后端程序访问 MySQL 时使用的主机地址，而不是小程序访问的地址。

常见情况：

| 后端运行位置 | MySQL 运行位置 | 建议值 |
| --- | --- | --- |
| Mac 本机直接运行 Python 服务 | 同一台 Mac | `127.0.0.1` |
| 云服务器直接运行 Python 服务 | 同一台云服务器 | `127.0.0.1` |
| Docker 容器内运行后端 | Mac/Windows 宿主机 | `host.docker.internal` |
| Docker 容器内运行后端 | 同一个 Compose 网络的 MySQL | MySQL 服务名，例如 `mysql` |
| 云服务器 A | 云数据库或服务器 B | 数据库的内网地址，优先使用内网 |

需要特别注意：在 Docker 容器里，`127.0.0.1` 指的是后端容器自己，不是宿主机。如果 MySQL 在宿主机，容器配置为 `127.0.0.1` 通常会收到 `ECONNREFUSED`。

本地测试推荐：

```ini
MYSQL_HOST=127.0.0.1
```

### `MYSQL_PORT`

填写 MySQL TCP 监听端口。默认是：

```ini
MYSQL_PORT=3306
```

只有你安装 MySQL 时修改过端口、使用端口映射或云数据库提供了其他端口，才需要修改。

可以这样验证端口和账号：

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p
```

`-p` 后面不要直接写密码，让命令行交互输入，避免密码进入 shell 历史。

### `MYSQL_DATABASE`

填写项目使用的数据库名称。本项目 SQL 默认创建：

```ini
MYSQL_DATABASE=little_table
```

初始化命令需要从项目根目录运行：

```bash
cd /Users/yc/Desktop/food_project
mysql -h 127.0.0.1 -P 3306 -u root -p < database/schema.sql
mysql -h 127.0.0.1 -P 3306 -u root -p < database/seed.sql
```

第一条创建库和表，第二条写入 10 个分类与 20 道示例菜。完成后检查：

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p -e \
  "USE little_table; SHOW TABLES; SELECT COUNT(*) AS dishes FROM dishes;"
```

应能看到业务表，并且 `dishes` 数量为 20。若你把数据库名改成其他名称，也要同步修改 `database/schema.sql`、`database/seed.sql` 中的 `little_table`，否则脚本和后端会访问不同的库。

### `MYSQL_USER`

填写后端连接数据库所用的 MySQL 账号：

```ini
MYSQL_USER=root
```

本地首次测试可以暂时使用 root，生产环境不要这样做。推荐先用管理员账号执行 schema，再创建业务专用账号：

```sql
CREATE USER 'little_table_app'@'127.0.0.1'
  IDENTIFIED BY '替换成高强度随机密码';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON little_table.*
  TO 'little_table_app'@'127.0.0.1';

FLUSH PRIVILEGES;
```

然后改为：

```ini
MYSQL_USER=little_table_app
MYSQL_PASSWORD=<上面设置的密码>
```

MySQL 账号由“用户名 + 来源 Host”共同确定。若后端从 Docker 或另一台机器连接，`'little_table_app'@'127.0.0.1'` 可能无法匹配。生产环境应把 Host 限制成后端服务器的实际内网地址或网段，不建议为了省事长期使用 `%`。

### `MYSQL_PASSWORD`

填写 `MYSQL_USER` 对应账号的真实密码：

```ini
MYSQL_PASSWORD=你的真实密码
```

只有该 MySQL 账号确实配置为无密码时才留空。出现以下错误通常是账号、密码或来源 Host 不匹配：

```text
Access denied for user 'xxx'@'xxx'
```

密码包含 `#`、空格、引号等字符时，dotenv 解析可能产生歧义，建议用双引号包裹：

```ini
MYSQL_PASSWORD="包含特殊字符的密码"
```

### `MYSQL_CONNECTION_LIMIT`

这是服务端可同时建立的连接规模建议，不是 MySQL 服务端的全局最大连接数。两个人使用：

```ini
MYSQL_CONNECTION_LIMIT=10
```

已经足够，前期无需调整。数值过大不会让应用更快，反而可能浪费数据库连接。

## 四、微信登录配置：打开小程序测试时必填

### `WECHAT_APP_ID`

填写微信小程序 AppID。当前项目已经使用：

```ini
WECHAT_APP_ID=wx1e35ad5c79849fc0
```

它必须与以下文件中的 `appid` 完全相同：

```text
miniprogram/project.config.json
```

AppID 不是密码，可以出现在小程序工程中，但不要随意替换成另一个小程序的 AppID，否则 `wx.login` 产生的 code 与服务端使用的 AppID 不匹配。

### `WECHAT_APP_SECRET`

填写上述小程序对应的 AppSecret。一般在微信公众平台的小程序后台中，通过“开发管理 → 开发设置 → 开发者 ID”查看或重置。

```ini
WECHAT_APP_SECRET=<后台显示的完整 AppSecret>
```

注意：

- AppSecret 只放在 `server/.env`，绝不能写入 `miniprogram/`。
- AppSecret 与 AppID 必须属于同一个小程序。
- 重置 AppSecret 后，旧值立即不能继续使用，需要同步修改服务器 `.env` 并重启后端。
- 不要把 AppSecret 填到 `miniprogram/config/index.js`。

本项目登录流程是：

```text
小程序 wx.login
  → 获取一次性 code
  → POST /api/auth/wechat
  → 后端用 AppID + AppSecret 调用 code2Session
  → 获取 OpenID
  → 创建/查询用户
  → 返回项目自己的 JWT
```

因此，只要你要在微信开发者工具里真正打开页面，`WECHAT_APP_SECRET` 就是必填项。留空时后端会返回“微信登录尚未配置”，这是预期行为。

### 不配置 AppSecret，能不能先测试后端？

可以。`server/.env` 临时设置：

```ini
DEV_LOGIN_ENABLED=true
NODE_ENV=development
```

启动后调用：

```bash
curl -X POST http://127.0.0.1:3000/api/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"identity":"one","nickname":"本地测试一号"}'
```

响应中的 `data.token` 可用于 Postman 或 curl 测试后端接口。但当前小程序前端仍固定使用真实 `wx.login`，不会自动调用开发登录接口。这一开关只能帮助检查后端，生产环境必须保持：

```ini
DEV_LOGIN_ENABLED=false
```

## 五、微信订阅消息：首次核心测试全部可留空

以下六项只影响微信外部提醒，不影响登录、创建饭桌、菜单、收藏、点菜、状态和历史记录：

```ini
WECHAT_ORDER_TEMPLATE_ID=
WECHAT_ORDER_PAGE=pages/orders/orders
WECHAT_TEMPLATE_MEAL_KEY=
WECHAT_TEMPLATE_DISH_KEY=
WECHAT_TEMPLATE_MESSAGE_KEY=
WECHAT_TEMPLATE_DATE_KEY=
```

配置缺失时，订单仍会创建，并给对方生成小程序内部未读提醒；服务端会把订阅消息结果标记为“微信提醒暂未配置”。

### `WECHAT_ORDER_TEMPLATE_ID`

这是在微信公众平台“小程序后台 → 功能 → 订阅消息”中选用模板后得到的 Template ID，不是 AppID，也不是模板标题或模板编号。

示意值：

```ini
WECHAT_ORDER_TEMPLATE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

同一个值还要填写到：

```text
miniprogram/config/index.js
```

例如：

```javascript
module.exports = {
  apiBaseUrl: 'http://127.0.0.1:3000',
  wechatOrderTemplateId: '这里填同一个 Template ID'
}
```

前端需要它调用 `wx.requestSubscribeMessage`，后端需要它调用订阅消息发送接口。

### `WECHAT_ORDER_PAGE`

填写用户点击订阅消息后打开的小程序页面路径，不要以 `/` 开头：

```ini
WECHAT_ORDER_PAGE=pages/orders/orders
```

当前默认值已经有效，一般不需要改。服务端发送时会在后面添加订单参数：

```text
pages/orders/orders?id=<订单ID>
```

页面路径必须已经声明在 `miniprogram/app.json` 中，不能填写网页 URL、服务器 URL 或不存在的页面。

### 四个 `WECHAT_TEMPLATE_*_KEY`

这些值必须来自你选中的那一个模板详情。它们不是你自由命名的英文变量，也不是“餐次”“菜品”这样的中文标题。

后台模板详情通常会把字段显示成类似：

```text
餐次：thing1.DATA
菜品：thing2.DATA
留言：thing3.DATA
日期：date4.DATA
```

如果你的真实模板恰好如此，则填写：

```ini
WECHAT_TEMPLATE_MEAL_KEY=thing1
WECHAT_TEMPLATE_DISH_KEY=thing2
WECHAT_TEMPLATE_MESSAGE_KEY=thing3
WECHAT_TEMPLATE_DATE_KEY=date4
```

上面只是格式示例，不能原样照抄。不同模板的编号和字段类型可能完全不同。

当前服务端发送的数据映射是：

| 环境变量 | 当前发送内容 | 当前代码限制 |
| --- | --- | --- |
| `WECHAT_TEMPLATE_MEAL_KEY` | 早餐、午餐、晚餐等餐次 | 最多截取 20 个字符 |
| `WECHAT_TEMPLATE_DISH_KEY` | 多个菜名，用顿号连接 | 最多截取 20 个字符 |
| `WECHAT_TEMPLATE_MESSAGE_KEY` | 点菜留言或默认提示 | 最多截取 20 个字符 |
| `WECHAT_TEMPLATE_DATE_KEY` | 用餐日期 | `YYYY-MM-DD` |

你选模板时应尽量找到语义和字段类型都能匹配上述四项的模板。如果后台模板没有四个合适字段，不要硬填；应根据真实模板调整：

```text
server/app/main.py
```

配置完成后，两个人都需要分别在自己的微信账号中主动点击“开启点菜提醒”。订阅授权属于当前 OpenID，A 授权不会自动替 B 授权。拒绝授权或发送失败都不影响订单主流程。

## 六、腾讯云 COS：不测试图片上传时全部可留空

```ini
COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=
COS_BASE_URL=
COS_UPLOAD_MAX_MB=5
```

留空时仍可新增没有图片的菜，菜单会显示统一占位图。

### `COS_SECRET_ID` 与 `COS_SECRET_KEY`

这是一对腾讯云 API 永久访问密钥，可在腾讯云“访问管理 CAM → API 密钥管理”中创建。

```ini
COS_SECRET_ID=AKIDxxxxxxxxxxxxxxxx
COS_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

注意：

- 只填写到 `server/.env`。
- 不能写进小程序、Git、README 或数据库。
- 本项目用它在后端向腾讯云 STS 申请 15 分钟临时凭证；前端只拿到临时凭证。
- 前期可以使用有权限的测试密钥验证流程；长期使用建议创建权限受限的 CAM 子账号，而不是主账号密钥。
- 子账号至少要有调用 STS 获取临时身份并为目标 Bucket 授予上传所需权限，具体授权应结合你的 Bucket 和腾讯云 CAM 策略设置。

### `COS_BUCKET`

填写 COS 控制台显示的完整存储桶名称，必须包含数字 APPID 后缀：

```ini
COS_BUCKET=food-images-1251234567
```

错误示例：

```ini
COS_BUCKET=food-images
```

如果遗漏数字后缀，STS resource 和上传域名都会错误。

### `COS_REGION`

填写 Bucket 所在地域的英文标识，可以在 Bucket“概览/基本信息”页面找到：

```ini
COS_REGION=ap-shanghai
```

常见值还有 `ap-guangzhou`、`ap-beijing`。必须以你自己的 Bucket 页面为准，不能因为服务器在上海就默认 Bucket 也在上海。

### `COS_BASE_URL`

填写保存到数据库、供小程序 `<image>` 读取的根地址，不带末尾 `/`。

使用 COS 默认域名时：

```ini
COS_BASE_URL=https://food-images-1251234567.cos.ap-shanghai.myqcloud.com
```

使用自定义 CDN/访问域名时：

```ini
COS_BASE_URL=https://images.example.com
```

当前版本保存的是普通图片 URL，没有为每次读取生成临时 GET 签名。因此：

- 公有读、私有写 Bucket：上传后可直接显示，最方便进行前期测试。
- 私有读 Bucket：上传可能成功，但普通 URL 读取会返回 403，需要后续增加后端签名 URL 或代理读取逻辑。

如果你不希望菜品和饭后照片公开访问，建议先不要把 Bucket 改成公有读，而是后续让我补充私有读签名 URL。不要为了赶测试把包含隐私照片的 Bucket 整体公开。

### `COS_UPLOAD_MAX_MB`

单张图片大小限制，默认：

```ini
COS_UPLOAD_MAX_MB=5
```

服务端先检查客户端声明的大小和类型，STS policy 又会限制上传请求的 Content-Length、Content-Type 和唯一对象路径。允许格式为 JPG/JPEG、PNG 和 WEBP。菜品图片写入 `dish-images/`，成员头像写入 `avatar-images/`；两者都使用临时凭证，不会把 COS 密钥放进小程序。前期不建议提高限制。

### COS 控制台还需要配置什么

1. 在 COS Bucket 配置跨域访问 CORS。
2. 允许请求方法 `PUT`。
3. 允许请求头至少包含 `Authorization`、`Content-Type`、`x-cos-security-token`；测试阶段也可使用允许全部请求头。
4. 在微信公众平台把以下域名加入 `request 合法域名`：

```text
https://<完整Bucket>.cos.<Region>.myqcloud.com
```

如果 `COS_BASE_URL` 使用另一个域名，还应把该图片访问域名配置为 `downloadFile 合法域名`。当前上传使用 `wx.request + PUT`，不是 `wx.uploadFile`，因此不依赖 `uploadFile 合法域名`。

## 七、一份可直接参考的本地 `.env`

下面是结构示例，其中尖括号内容必须替换，不能原样使用：

```ini
NODE_ENV=development
PORT=3000
API_PUBLIC_URL=http://localhost:3000
JWT_SECRET=<运行 openssl rand -hex 32 生成>
JWT_EXPIRES_IN=7d

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=little_table
MYSQL_USER=root
MYSQL_PASSWORD="<你的 MySQL root 密码>"
MYSQL_CONNECTION_LIMIT=10

WECHAT_APP_ID=wx1e35ad5c79849fc0
WECHAT_APP_SECRET=<你的小程序 AppSecret>

WECHAT_ORDER_TEMPLATE_ID=
WECHAT_ORDER_PAGE=pages/orders/orders
WECHAT_TEMPLATE_MEAL_KEY=
WECHAT_TEMPLATE_DISH_KEY=
WECHAT_TEMPLATE_MESSAGE_KEY=
WECHAT_TEMPLATE_DATE_KEY=

COS_SECRET_ID=
COS_SECRET_KEY=
COS_BUCKET=
COS_REGION=
COS_BASE_URL=
COS_UPLOAD_MAX_MB=5

DEV_LOGIN_ENABLED=false
```

`API_PUBLIC_URL` 当前是预留字段，暂未被业务代码使用；它可以保持默认值。真正决定小程序请求地址的是：

```text
miniprogram/config/index.js
```

## 八、首次测试的准确顺序

### 第 1 步：初始化数据库

```bash
cd /Users/yc/Desktop/food_project
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

### 第 2 步：创建 `.env`

```bash
cd server
cp .env.example .env
openssl rand -hex 32
```

把生成结果填入 `JWT_SECRET`，再填写 MySQL 账号密码和微信 AppSecret。

### 第 3 步：安装并启动后端

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m compileall -q app
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

### 第 4 步：验证数据库健康状态

另开一个终端：

```bash
curl http://127.0.0.1:3000/health
```

正确响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "database": "connected"
  }
}
```

### 第 5 步：配置前端 API 地址

编辑：

```text
miniprogram/config/index.js
```

开发者工具和后端都在同一台 Mac 上时，可以先使用：

```javascript
apiBaseUrl: 'http://127.0.0.1:3000'
```

并在微信开发者工具本地设置中暂时关闭“校验合法域名”。这只适用于开发者工具调试。

真机预览时，手机中的 `127.0.0.1` 指手机自己，不能访问电脑后端。真机应改成已经部署并在微信后台登记的 HTTPS API 域名：

```javascript
apiBaseUrl: 'https://api.example.com'
```

### 第 6 步：用微信开发者工具打开前端项目

打开目录：

```text
/Users/yc/Desktop/food_project/miniprogram
```

确认开发者工具显示的 AppID 是 `wx1e35ad5c79849fc0`。

### 第 7 步：先测试核心闭环

暂时不配置 COS 和订阅消息，完成：

```text
登录
→ 创建小饭桌
→ 浏览 20 道示例菜
→ 收藏
→ 加入今天的小菜单
→ 提交
→ 更新订单状态
→ 完成
→ 历史记录
→ 再吃一次
```

### 第 8 步：再分别接 COS 和订阅消息

两个外部集成一次只接一个。这样出现问题时，可以快速判断是 COS、微信模板还是核心业务配置造成的。

## 九、常见错误对照

| 表现 | 常见原因 | 优先检查 |
| --- | --- | --- |
| `/health` 返回“数据库尚未连接” | MySQL 没启动、Host/Port 错误、账号无权限 | `MYSQL_HOST`、`MYSQL_PORT`、MySQL 服务状态 |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL 未监听或后端在 Docker 中误用了 localhost | 运行位置与端口映射 |
| `Access denied for user` | 用户名、密码或 MySQL 来源 Host 不匹配 | `MYSQL_USER`、`MYSQL_PASSWORD`、MySQL user 表 |
| `Unknown database 'little_table'` | 没执行 schema 或库名不一致 | `database/schema.sql`、`MYSQL_DATABASE` |
| 小程序提示“微信登录尚未配置” | AppSecret 为空 | `WECHAT_APP_SECRET` |
| 微信登录失败 | AppID/AppSecret 不配对、code 已使用或过期 | 两端 AppID、服务端日志、重新编译登录 |
| 开发者工具请求失败 | API 地址错误或合法域名校验 | `miniprogram/config/index.js`、开发工具设置 |
| 真机请求 `127.0.0.1` 失败 | 该地址指向手机本身 | 改用正式 HTTPS 域名 |
| “图片上传暂未配置” | 任一 COS 必填项为空 | COS 五项配置 |
| COS 上传返回 403 | Bucket/Region 错、CAM/STS 权限不足、CORS 或系统时间异常 | Bucket 概览、CAM policy、CORS、服务器时间 |
| 图片上传成功但页面不显示 | Bucket 私有读或 `COS_BASE_URL` 错 | 对象访问权限、图片 URL |
| “微信提醒暂未配置” | Template ID、AppSecret 或字段键不完整 | 六个订阅消息变量 |
| 订阅消息发送失败 | 用户未授权、模板字段类型不匹配、订阅次数已消耗 | 用户授权结果、模板详情、微信接口返回日志 |

## 十、服务端日志、进程与请求追踪

当前采用更常见的服务端约定：

- 应用代码负责定义日志结构、脱敏、级别和 Request ID；
- 应用只向 stdout/stderr 输出，不自己维护日志文件；
- 开发环境由 Uvicorn 启动指令决定是否用 `tee` 留存日志；
- 生产环境由 Docker、systemd、Supervisor 或云平台管理 PID、重启与日志轮转。

这样不会在 Uvicorn 自动重载时产生过期 PID 文件，也不会把业务进程与日志文件生命周期耦合。

### 日志配置

```ini
LOG_LEVEL=info
MYSQL_CONNECT_TIMEOUT_MS=5000
```

- `LOG_LEVEL`：可选 `debug`、`info`、`warn`、`error`。
- `MYSQL_CONNECT_TIMEOUT_MS=5000`：数据库不可达时最多等待约 5 秒。

### 三个常用启动命令

只在终端看日志，推荐日常使用：

```bash
cd /Users/yc/Desktop/food_project/server
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

同时在终端显示并保存到 `server/logs/dev.log`：

```bash
mkdir -p logs && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000 2>&1 | tee -a logs/dev.log
```

另开终端跟踪保存的日志：

```bash
tail -f logs/dev.log
```

生产启动：

```bash
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 3000
```

带 `tee` 的启动命令属于运行方式；应用本身并不知道日志最终被写入文件、Docker stdout、journald 还是其他平台。

### PID 怎么看

服务启动日志会输出 Python/Uvicorn 的 PID：

```text
INFO:     Uvicorn running on http://0.0.0.0:3000
```

本地 `uvicorn --reload` 会管理重载进程，通常直接在运行终端按 `Ctrl+C` 停止。需要检查端口对应进程时：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

再核对命令：

```bash
ps -p <上一步看到的PID> -o pid,ppid,command
```

生产环境不要依靠项目内 PID 文件；Docker 使用容器 PID，systemd 使用 `MainPID`，Supervisor 使用自己的进程表。

### 启动日志内容

成功监听后会输出：

- PID；
- 当前环境和监听地址；
- Health 地址；
- MySQL Host、Port、数据库名、用户名；
- 微信、COS、订阅消息是否完成配置。

日志不会输出 MySQL 密码、JWT、AppSecret、COS SecretKey、access token 或 session_key。日志对象中命中 `password`、`secret`、`token`、`authorization` 等名称的字段会被替换为 `[REDACTED]`。

### Request ID

每个请求都有 UUID 格式 Request ID，并且：

- 响应头包含 `X-Request-Id`；
- Health 响应包含 `data.requestId`；
- 请求完成日志和具体错误日志使用同一个 `requestId`。

```bash
curl -i http://127.0.0.1:3000/health
```

使用带 `tee` 的启动命令时，可以搜索某次请求：

```bash
rg '<Request ID>' logs/dev.log
```

### 数据库错误

客户端只返回安全的 503 响应；终端日志会保留可操作的错误码，例如：

```text
database.health_check_failed
error.code=ER_ACCESS_DENIED_ERROR
error.errno=1045
error.message=Access denied for user ...
```

| 日志错误 | 含义 | 处理 |
| --- | --- | --- |
| `ER_ACCESS_DENIED_ERROR` / 1045 | MySQL 收到请求但拒绝认证 | 检查 `.env` 密码解析、用户名及允许来源 Host |
| `ECONNREFUSED` | 目标端口没有 MySQL 监听 | 检查 MySQL 服务、Host、Port、安全组 |
| `ETIMEDOUT` | 网络被防火墙、安全组或路由阻断 | 检查白名单、内外网地址 |
| `ENOTFOUND` | Host 无法解析 | 检查域名和 DNS |
| `ER_BAD_DB_ERROR` | 数据库不存在 | 执行 `schema.sql` 并检查数据库名 |

dotenv 中未加引号的 `#` 会开始注释。例如真实密码是 `abcd#efgh`，错误写法：

```ini
MYSQL_PASSWORD=abcd#efgh
```

应用实际只能读到 `abcd`。正确写法：

```ini
MYSQL_PASSWORD="abcd#efgh"
```

修改 `.env` 后，`node --watch` 通常不会因为 `.env` 自动重启；请手动按 `Ctrl+C` 后重新执行启动命令。

### 端口占用

如果 3000 已被占用，新进程会输出：

```text
ERROR ... server.port_in_use {"port":3000,"suggestion":"lsof -nP -iTCP:3000 -sTCP:LISTEN"}
```

需要临时换端口时，修改 `.env` 的 `PORT`，并同步修改 `miniprogram/config/index.js`。

## 十一、安全检查清单

- [ ] 真实配置只放在 `server/.env`。
- [ ] `miniprogram/` 中只有公开的 AppID、API 域名和 Template ID。
- [ ] AppSecret、COS SecretKey、MySQL 密码未出现在 Git 状态中。
- [ ] 生产环境 `DEV_LOGIN_ENABLED=false`。
- [ ] 生产环境不使用默认 `JWT_SECRET`。
- [ ] 生产环境后端不用 MySQL root。
- [ ] MySQL 远程端口没有向整个公网开放。
- [ ] COS 永久密钥使用 CAM 子账号并遵循最小权限。
- [ ] 私有照片没有因为测试而意外公开。
- [ ] 微信后台只登记 HTTPS 正式域名。

## 十二、官方资料

- 微信小程序登录：<https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html>
- `wx.login`：<https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html>
- 小程序订阅消息：<https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html>
- 腾讯云 COS 小程序直传实践：<https://cloud.tencent.com/document/product/436/34929>
- 腾讯云 COS 临时密钥：<https://cloud.tencent.com/document/product/436/14048>
- 腾讯云 COS 上传安全限制：<https://cloud.tencent.com/document/product/436/104266>
- MySQL 连接参数：<https://dev.mysql.com/doc/refman/8.0/en/connection-options.html>
