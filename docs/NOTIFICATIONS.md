# 点菜与上菜提醒

小饭桌有两种提醒：**站内消息**保存在“消息提醒”页；**微信订阅消息**会尝试发到接收人的微信。微信消息需要接收人自己主动允许一次性订阅，不能由另一人代为授权，也不能在后台自动补次数。

## 谁收到什么

| 操作 | 微信接收人 | 使用的模板 |
| --- | --- | --- |
| A 首次提交一顿未上菜菜单 | 同桌的 B | 做饭提醒 |
| B 把这顿标记为已上菜 | 原点菜人 A | 做饭完成提醒 |

两位成员都会在站内看到点菜和上菜记录；微信消息按上表只发给对方或原点菜人。自己下单又自己上菜时，不会因此收到发给自己的微信提醒，可用页面上的测试按钮检查自身模板发送。

同一饭桌、日期和餐次的未上菜菜单只有一份。再次提交会把菜加进这顿菜单，站内消息提示菜单更新，但不会重复发送微信点菜提醒。发送微信消息在后端后台进行；授权不足、模板未配置或发送失败时，点菜与上菜仍可完成，站内消息仍保留。

## 订阅机会怎么计算

提交点菜、打开未上菜菜单或点击上菜时，小程序会在当前用户的操作中，尝试为尚未满额的模板申请订阅。“消息提醒 → 补充微信提醒”也可以主动申请。每位用户、每个模板在本项目里最多保留 **10 次预计可用机会**；满额后不会再申请该模板。成功发送消耗一次后，就又有补充空间。页面只有服务端余额实际增加时才显示“已增加”，满额则显示“已满”。

用户每次成功允许，只给**自己**的对应模板增加一次机会。A 的授权不会给 B 增加机会。如果微信客户端提供“总是保持以上选择”且用户选择允许，后续符合条件的请求可能不再反复显示弹窗；每次新机会仍须由用户操作触发，不能当作永久订阅。

**显示的次数是预计值。**微信没有提供普通一次性订阅模板的准确剩余次数查询；本项目根据授权回传与成功发送维护账本。用户在微信设置中改动订阅，或记录未能同步时，页面数字可能与微信实际状态不同。微信发送接口接受请求也不等于用户已读。小程序不提供“清零微信订阅次数”：清掉本地账本并不能清掉微信侧授权，反而会让两边不一致。

## 服务端模板配置

用户选用的模板及字段如下；Template ID 的**实际值只写在服务器 `.env`**，不写进前端或 Git。

| 事件 | 模板环境变量 | 字段键与内容 |
| --- | --- | --- |
| 点菜 | `WECHAT_ORDER_TEMPLATE_ID` | `thing6` 提交用户；`thing1` 菜品；`thing4` 备注 |
| 上菜 | `WECHAT_SERVED_TEMPLATE_ID` | `thing1` 提醒方；`thing2` 菜品名称 |

在 `/data/software/compose/little-table/server/.env` 设置对应字段键：

```ini
WECHAT_ORDER_TEMPLATE_ID=<做饭提醒 Template ID>
WECHAT_SERVED_TEMPLATE_ID=<做饭完成提醒 Template ID>
WECHAT_ORDER_PAGE=pages/order-detail/order-detail
WECHAT_TEMPLATE_USER_KEY=thing6
WECHAT_TEMPLATE_DISH_KEY=thing1
WECHAT_TEMPLATE_MESSAGE_KEY=thing4
WECHAT_SERVED_USER_KEY=thing1
WECHAT_SERVED_DISH_NAME_KEY=thing2
```

还需要 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET`。字段键须与自己在微信后台选用模板的详情一致。`GET /api/notifications/config` 只有在 AppID、AppSecret、模板 ID 和全部字段键齐全时，才向前端返回该模板 ID。修改生产 `.env` 后运行 `docker compose -f compose.production.yml up -d --force-recreate api`，单纯 restart 不会更新容器环境。

已有数据库按实际迁移记录依次执行尚未运行的 `008_wechat_subscription_credits.sql`、`009_cap_wechat_subscription_credits.sql`；全新数据库的 `database/schema.sql` 已包含所需表。不要重复执行已运行的迁移。

## 真机怎么验证

1. A、B 各自用自己的微信账号进入饭桌，在“消息提醒”允许两个模板，检查预计次数。
2. A 提交一顿新菜单，B 查看是否收到“做饭提醒”；A 给同一顿加菜，确认没有第二条微信点菜提醒。
3. B 点击上菜，A 查看是否收到“做饭完成提醒”。两人都检查站内消息。
4. 如果没收到，按接收人分别核对授权与预计次数，再查服务端 `wechat.subscribe_*` 日志。开发者工具模拟器不能代替微信客户端的真机测试。

“消息提醒”页还有“测试点菜提醒”和“测试做饭完成”两个按钮，**只发给当前登录账号**。有余额时消耗一次；没有余额时先请求当前用户授权，再立即测试发送。测试按钮能确认微信发送接口是否接受请求，不能保证最终送达或已读。

站内消息使用 `GET /api/notifications`、`PUT /api/notifications/read`；测试发送接口 `POST /api/notifications/test-send` 不允许指定其他人的 OpenID。
