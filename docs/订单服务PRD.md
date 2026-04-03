# 《订单服务详细 PRD》

## 1. 文档定位

订单服务是交易编排中心，负责下单幂等、快照固化、状态机、超时规则、退款触发与异常追踪。

## 2. 职责边界

### 2.1 负责内容

- 开放下单。
- 下单幂等。
- 商品命中与路由结果固化。
- 状态机推进。
- 超时扫描与异常标记。
- 触发扣款、履约、退款、通知。
- 订单查询与事件轨迹。
- 订单备注与人工异常处理。

### 2.2 不负责内容

- 供应商协议适配。
- 资金记账。
- 商品主数据维护。
- 渠道签名鉴权实现。

## 3. 下单请求模型

### 3.1 开放下单请求

| 字段 | 必填 | 说明 |
|---|---|---|
| `channelOrderNo` | 是 | 渠道订单号 |
| `mobile` | 是 | 充值手机号 |
| `faceValue` | 是 | 充值面额 |
| `product_type` | 否 | 开放接口枚举值为 `FAST` / `MIXED`，默认 `MIXED` |

### 3.2 幂等规则

幂等键固定为：

- `channelId + channelOrderNo`

同一幂等键重复提交时，直接返回原订单，不重复扣款。

## 4. 核心对象

| 字段 | 说明 |
|---|---|
| `orderNo` | 平台订单号 |
| `channelOrderNo` | 渠道订单号 |
| `channelId` | 渠道 ID |
| `mobile` | 充值手机号 |
| `province` | 自动识别出的省份 |
| `ispName` | 自动识别出的运营商 |
| `requestedProductType` | 请求的充值类型，默认 `MIXED` |
| `matchedProductId` | 命中的商品 ID |
| `salePrice` | 渠道售价 |
| `purchasePrice` | 命中的采购价 |
| `mainStatus` | 主状态 |
| `supplierStatus` | 供应商子状态 |
| `notifyStatus` | 通知子状态 |
| `refundStatus` | 退款子状态 |
| `monitorStatus` | 监控标记 |
| `productSnapshot` | 商品快照 |
| `channelSnapshot` | 渠道快照 |
| `supplierRouteSnapshot` | 候选供应商快照 |
| `riskSnapshot` | 风控快照 |
| `slaSnapshot` | SLA 快照 |

## 5. 核心流程

1. 渠道鉴权通过后进入下单。
2. 平台识别手机号归属地与运营商。
3. 商品服务匹配商品并输出候选映射。
4. 渠道服务校验授权、价格、限额、回调。
5. 结算与账务服务校验余额。
6. 风控服务同步预检。
7. 订单服务创建订单草稿并落快照。
8. 结算与账务服务扣款，扣款成功后订单正式生效。
9. Worker 提交供应商订单。
10. 供应商回调或轮询推进成功或失败。
11. 成功后回调渠道，失败后发起退款。

## 6. 状态机

### 6.1 主状态

- `CREATED`
- `PROCESSING`
- `SUCCESS`
- `FAIL`
- `REFUNDING`
- `REFUNDED`
- `CLOSED`

### 6.2 子状态

- `supplierStatus`：`WAIT_SUBMIT / ACCEPTED / QUERYING / SUCCESS / FAIL`
- `notifyStatus`：`PENDING / SUCCESS / RETRYING / DEAD_LETTER`
- `refundStatus`：`NONE / PENDING / SUCCESS / FAIL`
- `monitorStatus`：`NORMAL / TIMEOUT_WARNING / MANUAL_FOLLOWING / LATE_CALLBACK_EXCEPTION`

### 6.3 典型状态流转

```text
CREATED
  -> PROCESSING
  -> SUCCESS
  -> FAIL
  -> REFUNDING
  -> REFUNDED
```

## 7. 超时与退款规则

### 7.1 快充

- 10 分钟未成功：`monitorStatus = TIMEOUT_WARNING`
- 1 小时未成功：转 `FAIL`
- 随后自动进入 `REFUNDING -> REFUNDED`

### 7.2 混充

- 2.5 小时未成功：`monitorStatus = TIMEOUT_WARNING`
- 3 小时未成功：转 `FAIL`
- 随后自动进入 `REFUNDING -> REFUNDED`

### 7.3 自动退款触发条件

- 供应商明确失败
- 达到最终超时上限
- 人工关闭且订单尚未成功

## 8. 晚到回调与异常规则

1. 成功后收到失败回调：只记异常，不回滚。
2. 已退款后收到成功回调：标记 `LATE_CALLBACK_EXCEPTION`，禁止自动二次扣款。
3. 通知失败不改变订单主状态。
4. 风控拒绝不创建订单。

## 9. 接口设计

### 9.1 开放 API

- `POST /open-api/orders`
- `GET /open-api/orders/:orderNo`
- `GET /open-api/orders/:orderNo/events`

### 9.2 后台 API

- `GET /admin/orders`
- `GET /admin/orders/:orderNo`
- `GET /admin/orders/:orderNo/events`
- `POST /admin/orders/:orderNo/close`
- `POST /admin/orders/:orderNo/mark-exception`
- `POST /admin/orders/:orderNo/remarks`
- `POST /admin/orders/:orderNo/retry-notify`

后台列表查询必须支持以下过滤条件：

- `orderNo`
- `mobile`
- `supplierOrderNo`

### 9.3 内部事件入口

- 供应商受理/成功/失败事件
- 通知成功/失败事件
- 退款成功/失败事件

## 10. 数据设计建议

- `ordering.orders`
- `ordering.order_events`
- `ordering.order_remarks`
- `ordering.order_timeout_logs`

## 11. 验收标准

1. 支持基于 `channelId + channelOrderNo` 幂等。
2. 下单时能正确固化识别结果、商品快照、渠道快照、供应商快照、SLA 快照。
3. `FAST`、`MIXED` 两类订单的超时规则分别生效。
4. 失败会自动触发退款。
5. 晚到回调不会错误逆转终态。
6. 后台能按订单号、手机号、供应商订单号快速定位订单。

## 12. 明确不做

- 购物车、组合订单、拆单。
- 在线支付状态机。
- 部分履约、部分退款。
