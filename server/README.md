# 后端代码阅读说明

当前后端使用 Python 3、FastAPI 和 MySQL。虽然历史项目说明中曾出现 Node.js/Express，实际服务入口是 `app/main.py`，启动命令由 Uvicorn 执行。

## 本机 Python 环境

- `server/.venv/` 是当前电脑创建的 Python 虚拟环境，里面有 FastAPI、数据库驱动等依赖。它只服务于本机开发和测试，不是后端源代码，也不需要复制到生产服务器。
- `server/.venv.old/` 是以前遗留的虚拟环境备份，运行和部署流程都不会调用它。Git 不应保存整套解释器依赖；这里已忽略该目录并从版本跟踪中移除，现有本机文件会保留。以后确认不需要回退旧环境时，可以手动删除它。
- 新机器运行 `make install` 会创建 `.venv` 并根据 `requirements.txt` 安装依赖；已有环境则补齐/更新这些依赖。不要把 `.venv` 或 `.venv.old` 提交到 Git。

## 目录和文件

- `app/main.py`：FastAPI 应用和 HTTP 路由；按登录用户及当前饭桌限制数据范围。
- `app/config.py`：读取 `.env` 和进程环境变量，集中管理服务配置。
- `app/db.py`：MySQL 连接、事务和常用查询封装。
- `app/storage.py`：腾讯云 COS 图片对象操作、短期访问链接和删除。
- `scripts/`：用于已有数据维护的人工脚本。默认先预览；只有显式加 `--apply` 才会上传或修改数据。
- `tests/`：自动化回归测试，使用 mock 替代数据库、微信和 COS，不连接线上服务、不消耗真实订阅次数。

## 检查和运行测试

在 `server/` 目录执行：

```bash
make check
make test
```

`make check` 只检查 Python 语法能否编译；`make test` 会运行 `tests/` 下的 unittest 用例，验证订单删除、微信通知对象、订阅次数封顶和退款等行为。添加新业务逻辑时，应为关键规则补充对应回归测试。

详细部署和环境变量说明见仓库 `docs/DEPLOYMENT.md`、`docs/CONFIGURATION_GUIDE.md`。
