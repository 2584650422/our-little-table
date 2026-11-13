# 015：我们的时光数据库整理

目标为 `our_time`：16 张业务/模板表加 `table_guide`，保留所有现有用户、饭桌、日历、照片引用及订阅授权。映射见 `database/rename-map.json`；列 `couple_id` 改为 `space_id`，`order_id` 改为 `meal_id`。API 的 `/api/couples`、`/api/orders` 等地址与 coupleId/orderId 字段继续兼容旧小程序包；后端仍根据登录令牌加载的空间 ID 限定全部共享数据。

## 迁移方式

MySQL 5.7 没有单条数据库改名命令，DDL 也不能依赖事务回滚。本次采用“导出旧库 → 恢复新库 → 在新库运行 015 → 核对 → 同时切换后端和数据库配置”。旧库保留作为回滚来源，不对旧库做原地改名。

1. 保存运行中的 Deployment、ConfigMap、服务端 `.env` 和旧镜像摘要，备份目录权限 700、文件 600，不上传 Git。
2. 在线导出一份 `--single-transaction --routines --triggers` 的旧库到私有备份，在独立演练库恢复。运行 `015_space_schema.sql`；不得在旧生产库直接执行。
3. 用候选镜像运行 `schema_admin.py`，逐表比较全部行的规范化 SHA-256、记录数，并核对表说明覆盖全部实际表、外键仍在本库且无孤立引用。
4. 额外用 `our_time_test_` 开头的独立空库验证全新 schema 和真实 MySQL/API 流程，不调用微信或 COS、不创建生产演示数据。
5. 停止 API 写入后重新导出最终旧库备份，恢复到空的 `our_time`，再次运行 015 并完整核对。此时不要让新旧 API 同时写不同的库。
6. 将服务端 `MYSQL_DATABASE` 改为 `our_time`，同步 ConfigMap，切换候选镜像并恢复服务。读取健康检查及双方认证业务接口。
7. 保留旧库和回滚备份，验收完成前不清除。新库开始承接写入后，不能直接切回旧库丢弃新增数据，应先停写并核对迁移后新增内容。

## 核对工具

`server/scripts/schema_admin.py SOURCE TARGET MAPPING_JSON` 只读运行，连接采用后端现有环境变量；操作者需要两库读取权限。输出仅含表名、数量和校验结果，不输出用户内容、OpenID、模板 ID 或密码。

新库中的外键与索引名称可能保留历史标识，业务只依赖实际表、列与约束行为，不为美化名字重建全部索引。

## 中文表说明

`database/catalog.json` 是表说明的唯一编辑入口，维护模块、用途、保存内容和隐私维护提示：

```bash
python3 scripts/build_schema_docs.py
python3 scripts/build_schema_docs.py --check
```

工具同步生成新库 schema 的说明段、015 迁移、`table-guide.sql` 和 `docs/database-tables.md`。既有新库只更新说明时运行 `table-guide.sql`，不能再运行结构迁移 015。

## 资源名称

云端项目目录及后端服务已统一为 our-time、our-time-api，详见 [服务命名迁移](service-names.md)。旧服务器目录保留兼容链接，数据库迁移回滚脚本也已同步新服务名。

COS 已有对象的 little-table/ 前缀与 API 域名继续沿用，不能随目录或服务改名更换。当前本地工作区仍为原路径，方便开发者工具和聊天关联。

## 微信订阅表

授权表是防重复计次的收据；余额表是可发送机会的估算。一次授权只增加一次、同一请求重试不增加，发送前原子扣减，明确失败时退款或归零。模板更换会使用不同模板 ID；旧授权不能无条件视为新模板授权。不能为了表更短而删除去重记录或合并两种职责。

参考：[MySQL 5.7 ALTER TABLE](https://dev.mysql.com/doc/refman/5.7/en/alter-table.html)。最终迁移结果以当前服务器 MySQL 的恢复演练与数据校验为准。

## 本次已完成的切换与回滚入口

2026-11-05 已完成 015；当前 API 版本 20261105-02。私有备份位于 `/data/software/compose/backups/our-time-refactor-20261105-02/`，旧库保持原样。

需要回退时，先安排停止写入，再执行下面的带核对脚本。它会停止 API、比较新旧完整数据；如果已经有新记录或修改，会恢复当前新后端并拒绝直接切回旧库。

```bash
sudo bash /data/software/compose/backups/our-time-refactor-20261105-02/rollback.sh \
  /data/software/compose/our-time/releases/20261105-02 \
  /data/software/compose/backups/our-time-refactor-20261105-02
```

源码与脚本均已保存，尚未实际执行生产回滚；已完成旧库恢复与完整数据比对演练。回滚后也要同步本地和服务器的 K3s YAML 镜像摘要与 MYSQL_DATABASE 配置，再验证业务接口。


## 016：想你了与接收偏好

在015后的our_time新增thought_messages与notification_preferences；全新schema包含这两表，现有库执行016后再更新table-guide.sql。数据库说明由catalog.json生成；015不会提前引用016新增表，迁移历史保持顺序兼容。详见 [想你了](thoughts.md)。

2026-11-12 已通过DBX在当前our_time执行016新增表及表目录提交；现共19张表，table_guide共19条且无缺失说明。未插入演示业务记录。
