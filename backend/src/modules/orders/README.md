# 订单服务模块详细设计

## 模块职责

- 负责创建订单、维护状态机、记录事件、输出查询与轨迹能力。
- 统一接收支付、供应商、退款、通知等标准事件。

## 核心表

- `ordering.orders`
- `ordering.order_events`
- `ordering.order_remarks`

## 核心接口

- `POST /open-api/orders`
- `GET /open-api/orders/:orderNo`
- `GET /open-api/orders/:orderNo/events`
- `GET /admin/orders`
- `POST /admin/orders/:orderNo/close`
- `POST /admin/orders/:orderNo/mark-exception`

## 关键规则

- `channelId + channelOrderNo` 幂等。
- 每次状态推进都要写事件表。
- 终态默认不可被晚到事件直接覆盖。

## 测试重点

- 重复下单幂等。
- 支付成功后进入待履约。
- 供应商成功后进入成功并触发结算与通知。
- 供应商失败后进入退款链路。
