# 《通知服务详细 PRD》

## 1. 文档定位

通知服务负责 Webhook 终态通知，包括签名、投递、重试、死信与投递日志。

## 2. 职责边界

### 2.1 负责内容

- 终态通知任务创建。
- Webhook 签名生成。
- Webhook 投递。
- 失败重试。
- 死信记录。
- 投递日志查询。

### 2.2 不负责内容

- 短信、邮件。
- 订单状态判断。
- 渠道主体维护。

## 3. 通知范围

仅对订单终态发送通知：

- `ORDER_SUCCESS`
- `ORDER_REFUNDED`

说明：

- `TIMEOUT_WARNING` 仅做内部监控，不对外通知。

## 4. 核心对象

| 对象 | 关键字段 |
|---|---|
| NotifyTask | `taskNo`、`orderNo`、`eventType`、`status`、`retryCount` |
| DeliveryLog | `taskNo`、`requestBody`、`responseBody`、`httpStatus`、`latency` |
| DeadLetter | `taskNo`、`reason`、`lastAttemptAt` |

## 5. 核心规则

1. 通知使用订单创建时固化的回调配置。
2. 终态通知至少投递一次。
3. 通知失败不阻塞订单终态。
4. 相同任务重试必须幂等。
5. 后台任务详情必须可查看最近一次投递结果与重试计划。

## 6. 重试策略

建议重试时间：

- 立即
- 1 分钟
- 5 分钟
- 15 分钟
- 30 分钟
- 60 分钟

超出后进入死信。

## 7. 接口设计

### 7.1 后台 API

- `GET /admin/notifications/tasks`
- `GET /admin/notifications/tasks/:taskNo`
- `GET /admin/notifications/tasks/:taskNo/delivery-logs`
- `POST /admin/notifications/tasks/:taskNo/retry`
- `GET /admin/notifications/dead-letters`

### 7.2 内部能力

- 通知创建通过领域事件触发。
- 通知投递由 Worker 统一调度。

## 8. 数据设计建议

- `notification.notification_tasks`
- `notification.notification_delivery_logs`
- `notification.notification_dead_letters`

## 9. 异常处理

- 回调地址不可达：进入重试。
- 签名构造失败：任务直接失败并报警。
- 长期失败：进入死信，由后台人工重试。

## 10. 验收标准

1. 成功订单可触发成功通知。
2. 退款订单可触发退款通知。
3. Webhook 失败后会自动重试。
4. 超过重试次数的任务会进入死信。
5. 技术支持可查看任务详情与投递日志用于排障。

## 11. 明确不做

- 短信通知。
- 邮件通知。
- 多模板消息中心。
