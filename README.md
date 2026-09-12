# 两个人的小饭桌

一个只给两个人使用的私人微信点菜小程序。它把会做的菜、想吃的零食和一起吃过的饭放进同一本温暖的小菜单，帮你们更轻松地回答“今天吃什么”。

## 已实现

- 微信 `wx.login → code2Session → JWT` 登录，自定义昵称。
- 创建饭桌、7 天邀请码加入、最多两位成员。
- 20 道无版权网络图片依赖的初始菜品和 10 个分类；创建饭桌后复制为两个人可自由编辑的私有菜单。
- 左侧分类、右侧大图菜品的点单布局，支持搜索、详情、估算热量、个人收藏和自动点单次数；分类同步显示本次已选数量，可拖动的小菜单入口避免遮挡菜品。
- “今天的小菜单”数量、餐次、日期、留言与热量合计。
- 订单六状态流转、不可变菜品快照、历史记录和“再吃一次”。
- 收藏与近期食用降权的规则推荐。
- 菜品与分类新增、编辑、排序和软下架。
- 小饭桌改名、纪念日、饭桌级首页文案、本人称呼、成员查看、邀请码刷新和安全退出管理。
- 四个底部 Tab 使用项目内置双态 PNG 图标，无需 COS 或网络资源。
- 成员可为自己设置头像；未设置时继续使用昵称首字头像。头像通过 COS 临时凭证上传，伴侣头像只读。
- 腾讯云 COS STS 安全直传，未配置时统一占位状态。
- 微信订阅消息基础框架与小程序内未读提醒；通知失败不影响点菜。
- 奶油粉原生小程序 UI、Loading、空状态、错误重试和生活化 Toast。

## 技术架构

- 小程序：原生 JavaScript + WXML + WXSS。
- API：Node.js 20 + Express + JWT。
- 数据：MySQL 8 + `mysql2/promise`。
- 外部服务：微信开放接口、腾讯云 COS STS。

设计细节见 [PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md)，安全和分层见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 主要目录

```text
.
├── miniprogram/         # 可由微信开发者工具独立打开的前端项目
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json
│   ├── components/      # 菜品、空状态、订单状态组件
│   ├── config/          # 小程序 API 与公开 Template ID
│   ├── pages/           # 首页、菜单、详情、点菜单、订单、我们、管理
│   ├── services/        # 小程序统一请求与业务 API
│   └── utils/           # 点菜单、格式化、COS 签名
├── server/              # Express API、Dockerfile、环境变量模板
├── database/            # schema.sql、seed.sql、增量 migrations
└── docs/                # 产品、架构、部署文档
```

## 快速开始

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
cd server
cp .env.example .env
npm install
npm run dev
```

然后：

1. 填写 `server/.env` 中 MySQL、微信 AppSecret、JWT；COS 和订阅消息可稍后填。
2. 修改 `miniprogram/config/index.js` 的 `apiBaseUrl`。
3. 使用微信开发者工具打开 `food_project/miniprogram`。现有 AppID `wx1e35ad5c79849fc0` 已原样迁移并保留。
4. 本地联调可暂时关闭合法域名校验；真机和发布必须使用后台登记的 HTTPS 域名。

第一次配置建议先阅读 [首次测试配置指南](docs/CONFIGURATION_GUIDE.md)。完整 Docker、Nginx 与生产部署步骤见 [DEPLOYMENT.md](docs/DEPLOYMENT.md)。

如果数据库不是用当前最新版 `schema.sql` 新建的，请按文件编号依次执行尚未执行的增量迁移：

```bash
mysql -u root -p little_table < database/migrations/001_couple_owned_categories.sql
mysql -u root -p little_table < database/migrations/002_couple_home_copy.sql
mysql -u root -p little_table < database/migrations/003_separate_starter_menu.sql
```

全新安装只执行 `schema.sql` 和 `seed.sql`，不要再重复执行增量迁移。`002` 为每张小饭桌增加可编辑的首页主标题与副标题；`003` 把初始化菜单拆入独立的 `starter_categories`、`starter_dishes`，此后实际分类和菜品的 `couple_id` 不允许为空。`users.couple_id` 仍允许为空，因为尚未创建或加入饭桌的用户需要这个状态。

## 配置说明

- MySQL：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。
- 微信登录：`WECHAT_APP_ID`、`WECHAT_APP_SECRET`（只在服务端）。
- API 域名：小程序 `miniprogram/config/index.js`。
- COS：服务端 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`、`COS_BASE_URL`。
- 订阅消息：前端公开 Template ID + 服务端 Template ID 和实际字段键。

## 验证

```bash
cd server
npm run check
curl http://127.0.0.1:3000/health
```

`/health` 只有在 MySQL 配置正确且 schema 已导入后才返回 `database: connected`。

应用以标准方式把结构化日志输出到 stdout/stderr，包含进程 PID、脱敏配置摘要、请求 ID、状态码、耗时和数据库原始错误。日常开发直接运行：

```bash
cd server
npm run dev
```

需要同时保存本地日志时运行：

```bash
npm run dev:log
```

该启动命令通过 `tee` 保存到 `server/logs/dev.log`。PID 和生产日志管理交给 `node --watch`、Docker、systemd 或 PM2，不由应用写 PID 文件。完整说明见 [首次测试配置指南的日志与进程章节](docs/CONFIGURATION_GUIDE.md#十服务端日志进程与请求追踪)。

## TODO

- 用真实微信 AppSecret、MySQL、域名、COS 和订阅模板完成双账号真机联调。
- 补充自有菜品照片；当前无图统一展示项目内 CSS 占位，不引用网络图片。
- 增加饭后评价、成品照片与饭饭日历。
- 增加替换菜图后的旧 COS 对象清理任务。
- 根据最终订阅模板字段类型调整消息值并完成审核验证。
