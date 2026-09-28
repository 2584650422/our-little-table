# 两个人的小饭桌

一个只给两个人使用的私人微信点菜小程序。它把会做的菜、想吃的零食和一起吃过的饭放进同一本温暖的小菜单，帮你们更轻松地回答“今天吃什么”。

## 已实现

- 微信 `wx.login → code2Session → JWT` 登录，自定义昵称。
- 创建饭桌、7 天邀请码加入、最多两位成员；已加入的饭桌会保存在账号关联列表中，可随时切换。
- 20 道无版权网络图片依赖的初始菜品和 10 个分类；创建饭桌后复制为两个人可自由编辑的私有菜单。
- 左侧分类、右侧大图菜品的点单布局，支持搜索、详情、估算热量、个人收藏和自动点单次数；分类同步显示本次已选数量，左侧底部固定“已选菜品”入口，支持展开清单、一键清空和提交。
- “今天的小菜单”数量、餐次、日期、留言与热量合计。
- 简化为“提交 → 上菜”的订单流程；上菜时可选上传成品照片，历史记录支持评论、补充照片、二次确认后删除和“再吃一次”。
- 收藏与近期食用降权的规则推荐。
- 菜品与分类新增、编辑、分类手柄拖动排序和软下架；二级与三级页面沿用已确认的原型风格。
- 小饭桌设置按资料、饭桌、首页展示和管理分组；独立成员页查看成员资料及邀请码。支持饭桌背景照片更换/恢复默认、饭桌改名、纪念日、本人称呼、邀请码刷新、切换、退出及二次确认的永久删除。
- 四个底部 Tab 使用项目内置双态 PNG 图标，无需 COS 或网络资源。
- 成员可为自己设置头像；未设置时继续使用昵称首字头像。头像通过 COS 临时凭证上传，伴侣头像只读。
- 腾讯云 COS STS 安全直传，未配置时统一占位状态。
- 上传前交互式裁切：头像 1:1，菜品和饭后照片 4:3；原图不超过 10MB，上传文件压缩到 2MB 以内。
- 同饭桌、同餐次、同日期的未上菜菜单合并更新；首次点菜提醒对方，上菜提醒点菜人。当前操作者可在提交、查看未上菜菜单或上菜时顺带订阅，站内消息保留为兜底，详见 [消息通知配置](docs/NOTIFICATIONS.md)。
- 奶油粉原生小程序 UI、Loading、空状态、错误重试和生活化 Toast。

## 技术架构

- 小程序：原生 JavaScript + WXML + WXSS。
- API：Python 3.9+ + FastAPI + JWT。
- 数据：MySQL 8 + PyMySQL。
- 外部服务：微信开放接口、腾讯云 COS STS。

设计细节见 [PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md)、[已确认的二级页面原型](docs/prototypes/README.md) 与 [图片规格](docs/IMAGE_POLICY.md)，安全和分层见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 主要目录

```text
.
├── miniprogram/         # 可由微信开发者工具独立打开的前端项目
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json
│   ├── components/      # 菜品、空状态、订单状态组件
│   ├── config/          # 小程序 API 地址
│   ├── pages/           # 首页、菜单、详情、点菜单、订单、我们、管理
│   ├── services/        # 小程序统一请求与业务 API
│   └── utils/           # 点菜单、格式化、COS 签名
├── server/              # FastAPI、Dockerfile、环境变量模板
│   ├── app/             # Python 路由、认证、MySQL 与第三方集成
│   ├── scripts/         # 只补缺图的菜品照片导入工具
│   ├── requirements.txt # Python 依赖锁定
│   └── Makefile         # install / dev / start / check 快捷命令
├── database/            # schema.sql、seed.sql、增量 migrations
└── docs/                # 产品、架构、部署文档
```

## 快速开始

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
cd server
cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

安装完成后也可以在 `server/` 中直接运行 `make dev`；检查 Python 语法使用 `make check`。

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
mysql -u root -p little_table < database/migrations/004_couple_memberships.sql
mysql -u root -p little_table < database/migrations/005_private_cos_object_keys.sql
mysql -u root -p little_table < database/migrations/006_couple_background.sql
```

全新安装只执行 `schema.sql` 和 `seed.sql`，不要再重复执行增量迁移。`002` 为饭桌首页文案；`003` 拆分初始化菜单；`004` 增加稳定饭桌 UUID 与成员关系；`005` 增加私有 COS 对象 Key；`006` 增加饭桌背景图。`007_remove_category_icons.sql` 会删除旧列，**只能在部署并验证不再查询 `icon` 的新版 API 后执行**，执行前备份数据库。`users.couple_id` 仍允许为空，以表示尚未创建或加入饭桌。

## 配置说明

- MySQL：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。
- 微信登录：`WECHAT_APP_ID`、`WECHAT_APP_SECRET`（只在服务端）。
- API 域名：小程序 `miniprogram/config/index.js`。
- COS：服务端 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`；私有桶通常让 `COS_BASE_URL` 留空，并使用 `COS_KEY_PREFIX` 与 `COS_SIGNED_URL_EXPIRES_SECONDS`。
- 订阅消息：Template ID 与字段键都配置在服务端 `.env`，小程序通过 API 读取公开 Template ID；详见 [消息通知配置](docs/NOTIFICATIONS.md)。

已有菜品批量补图：在 `server/` 下运行 `PYTHONPATH=. .venv/bin/python scripts/import_dish_photos.py --couple-id 1 --folder /你的图片目录` 预览；确认后加 `--apply`。脚本仅为缺图且文件名与菜名匹配的菜品上传，不覆盖已有照片。图片命名如 `01-可乐鸡翅.jpg`，单张不超过 2MB。

## 验证

```bash
cd server
.venv/bin/python -m compileall -q app
curl http://127.0.0.1:3000/health
```

`/health` 只有在 MySQL 配置正确且 schema 已导入后才返回 `database: connected`。

应用以标准方式把结构化日志输出到 stdout/stderr，包含进程 PID、脱敏配置摘要、请求 ID、状态码、耗时和数据库原始错误。日常开发直接运行：

```bash
cd server
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000
```

需要同时保存本地日志时运行：

```bash
mkdir -p logs && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 3000 2>&1 | tee -a logs/dev.log
```

该启动命令通过 `tee` 保存到 `server/logs/dev.log`。PID 和生产日志管理交给 Uvicorn、Docker、systemd 或 Supervisor，不由应用写 PID 文件。完整说明见 [首次测试配置指南的日志与进程章节](docs/CONFIGURATION_GUIDE.md#十服务端日志进程与请求追踪)。

## TODO

- 用真实微信 AppSecret、MySQL、域名、COS 和订阅模板完成双账号真机联调，并按顺序应用尚未运行的数据库迁移，包括 `008_wechat_subscription_credits.sql` 和 `009_cap_wechat_subscription_credits.sql`。
- 补充自有菜品照片；当前无图统一展示项目内 CSS 占位，不引用网络图片。
- 可进一步增加饭饭日历，并根据真机截图继续微调不同设备的安全区和字号。
