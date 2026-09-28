# 点菜与上菜消息

同一饭桌、同一餐次和日期的未上菜菜单只有一份。再次提交时，新增菜品合并到该菜单并更新数量，不重复发微信点菜提醒；站内消息会告诉另一位成员菜单有更新。

每次正式提交点菜、打开未上菜菜单或点击上菜时，小程序会在当前用户的点击操作中请求尚未达到上限的模板订阅。每位用户、每个模板最多保留 10 次可用机会；到达上限后客户端不再申请该模板，服务端也会把记录和失败退款限制在 10 次。授权接口返回“实际新增数”，只有服务端余额确实增加时才显示“已增加”；满额或并发时没有新余额就显示“已满”。成功发送消耗一次后，该模板重新有补充空间。用户在这台微信账号上选择“总是保持以上选择”后，后续符合条件的调用可沿用允许状态，不再反复弹窗。每个成功授权只增加当前用户、当前模板的一次发送机会；A 的授权不能增加 B 的机会。

提交菜单后，微信“做饭提醒”只发给另一位成员，并消耗接收人的“做饭提醒”机会。上菜后，“做饭完成提醒”只发给原点菜人，并消耗该人的完成提醒机会。发送发生在后台任务，不阻塞点菜和上菜。机会不足、授权被关闭、模板或发送失败时，站内消息仍照常保留；具体结果以服务端 `wechat.subscribe_*` 日志为准。

微信不提供普通一次性模板的准确剩余次数查询。本小程序根据客户端回传的授权结果与服务端成功发送记录维护预计次数；用户在微信设置中调整订阅，或客户端与服务端记录未能同步时，显示值会与微信实际状态不同。发送接口成功表示微信已接受下发请求，不等同于用户已读。

本项目不提供“清零微信订阅次数”功能。删除或清零本地预计余额不会重置微信侧的授权，反而会造成服务端账本和微信实际状态不一致；若需测试，可使用下方测试按钮消耗一条已有机会。

## 当前模板与数据字段

模板字段来自用户 2026-09-28 提供的微信后台模板详情截图：

| 事件 | 模板 | Template ID | 字段键及内容 |
| --- | --- | --- | --- |
| 点菜 | 做饭提醒 | `WECHAT_ORDER_TEMPLATE_ID` | `thing6` 提交用户；`thing1` 菜品；`thing4` 备注 |
| 上菜 | 做饭完成提醒 | `WECHAT_SERVED_TEMPLATE_ID` | `thing1` 提醒方；`thing2` 菜品名称 |

Template ID 只保存在服务端忽略文件 `server/.env`，不写入前端或 Git。字段键也以服务端环境变量配置；`GET /api/notifications/config` 仅在 AppID、AppSecret、Template ID 和全部对应字段键均齐全时返回模板 ID。

## 服务端配置

在服务端 `server/.env` 配置以下变量：

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

同时需要已有的 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET`。AppSecret 只能留在服务端。修改部署环境 `.env` 后要重建 API 容器，单纯 restart 不会重新读取 compose 环境变量。

## 数据库迁移

现有数据库需按顺序执行尚未运行的迁移。`008_wechat_subscription_credits.sql` 创建订阅授权与预计次数记录表；`009_cap_wechat_subscription_credits.sql` 将已有余额收敛到每类最多 10 次。不要重复执行已运行的迁移。全新数据库的 `database/schema.sql` 已包含所需表结构。

## 真机验证

1. 双方在自己的微信账号登录，确认各自能进入“消息提醒”。
2. 各自在点击授权时允许两个模板；若不想每次看到弹窗，可在微信弹窗中选择记住允许。
3. A 提交一份未上菜菜单，B 应收到“做饭提醒”；A 在未上菜期间给同餐次加菜，菜单会合并且不额外发送微信点菜消息。
4. B 打开未上菜菜单并点击上菜，A 应收到“做饭完成提醒”。
5. 在“消息提醒”页查看预计剩余次数；如果次数不足，对应接收人再次在相关操作中允许订阅即可积累机会。

消息提醒页面另有“测试点菜提醒”和“测试做饭完成”两个按钮，**测试消息只发送给当前登录账号**。已有余额时直接消耗该模板一次机会；没有余额时先申请对应模板，再立即发送，因此新授权后测试的预计余额通常不变。测试按钮可确认微信发送 API 是否接受请求，但不能保证微信最终送达或已读。测试真机时需要在微信客户端打开预览版，而不是仅用开发者工具模拟器。

站内消息 API：`GET /api/notifications`、`PUT /api/notifications/read`。订阅状态记录 API 仅接受当前已配置的模板 ID，并由登录 token 确定用户身份。测试发送 API `POST /api/notifications/test-send` 仅向当前登录账号发送，调用者不能指定其他人的 OpenID。

参考：[微信小程序订阅消息概述](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message-overview.html)、[前端授权 API](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html)、[服务端发送 API](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage)。
