# 通知服务模块详细设计

## 模块职责

- 仅处理订单终态 Webhook 通知任务。
- 负责签名、投递、重试、死信与投递日志。

## 核心表

- `notification.notification_tasks`
- `notification.notification_delivery_logs`
- `notification.notification_dead_letters`

## 核心接口

- `GET /admin/notifications/tasks`
- `GET /admin/notifications/tasks/:taskNo`
- `GET /admin/notifications/tasks/:taskNo/delivery-logs`
- `POST /admin/notifications/tasks/:taskNo/retry`
- `GET /admin/notifications/dead-letters`

## 关键规则

- 通知使用订单快照中的回调配置。
- 仅允许 `SUCCESS` 与 `REFUNDED` 终态订单创建通知任务。
- 投递失败必须进入重试或死信。

## 测试重点

- `mock://success` 会直接成功。
- `mock://fail` 会进入重试，最终转死信。
- 通知结果会回传订单服务。
