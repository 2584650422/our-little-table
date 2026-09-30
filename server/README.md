# 后端：从哪里读起

小饭桌后端使用 Python 3.9+、FastAPI、PyMySQL。服务入口是 `app/main.py`，HTTP 接口统一返回 `{ code, message, data }`。已登录用户的饭桌数据由 token 对应的 `couple_id` 限定。

| 路径 | 用途 |
| --- | --- |
| `app/main.py` | 路由、登录、饭桌权限、点菜、通知等业务流程 |
| `app/config.py` | 从环境变量读取配置 |
| `app/db.py` | MySQL 连接、查询和事务 |
| `app/storage.py` | COS 图片上传凭证、临时读取链接和清理 |
| `tests/` | 使用模拟数据库/微信/COS 的回归测试，不连接生产服务 |
| `scripts/` | 需人工执行的数据维护脚本；先预览，明确加 `--apply` 才修改 |
| `Dockerfile`、`compose.production.yml` | 生产镜像与独立 API 容器配置 |

## 本机运行

先按[配置指南](../docs/configuration.md)准备 MySQL。在 `server/` 目录执行：

```bash
cp .env.example .env
# 编辑 .env，填写实际环境所需的值
make install
make dev
```

`make install` 创建 `server/.venv/` 并安装依赖；`.venv/` 是本机 Python 环境，不属于源码。如果本机还有旧的 `.venv.old/`，它也不会参与运行或部署，确认不再需要时可删除。两者都不会提交到 Git。`make dev` 在 3000 端口启动热重载服务；访问 `http://127.0.0.1:3000/health` 检查数据库连接。

```bash
make check   # 编译检查 Python 语法
make test    # 运行 tests/ 下的 unittest 回归测试
```

## `.env` 到底由谁读取？

本机运行时，`app/config.py` 调用 `python-dotenv` 的 `load_dotenv()`，再用 `os.getenv()` 读取配置。生产容器由 `compose.production.yml` 的 `env_file: .env` 把同目录服务器 `.env` 注入进程，`config.py` 仍通过 `os.getenv()` 读取。服务器文件在 `/data/software/compose/little-table/server/.env`，只保存在服务器，权限应为 `600`。改动后要执行 `docker compose -f compose.production.yml up -d --force-recreate api`；单纯 `restart` 不会更新容器里的环境变量。

部署、更新和日志命令见[容器运维](../docs/operations.md)；各配置项的用途见[配置指南](../docs/configuration.md)。
