# 《渠道服务详细 PRD》

## 1. 文档定位

渠道服务负责外部主体管理与开放接口接入控制，包括开放鉴权、商品授权、价格、限额、回调配置以及渠道档案与额度查询。

## 2. 职责边界

### 2.1 负责内容

- 渠道主体管理。
- `AccessKey / Sign / Timestamp / Nonce` 开放 API 鉴权。
- 商品授权。
- 渠道销售价配置。
- 单笔限额、日限额、QPS 限额。
- Webhook 回调配置。
- 渠道档案查询。
- 渠道额度查询。

### 2.2 不负责内容

- 后台用户登录。
- 渠道余额记账。
- 商品主数据维护。
- 订单状态推进。

## 3. 渠道模型

### 3.1 单层渠道模型

- 渠道主体采用单层模型。
- 不引入代理、子代理层级树与价格继承能力。
- 所有授权、价格、限额、回调配置均直接归属到渠道主体。

## 4. 核心对象

| 对象 | 关键字段 |
|---|---|
| Channel | `channelId`、`channelCode`、`channelType`、`status` |
| Credential | `accessKey`、`secretKey`、`status`、`expiredAt` |
| ProductAuthorization | `channelId`、`productId`、`status` |
| PricePolicy | `channelId`、`productId`、`salePrice`、`currency`、`status` |
| LimitRule | `channelId`、`singleLimit`、`dailyLimit`、`qpsLimit` |
| CallbackConfig | `channelId`、`callbackUrl`、`signSecret`、`retryEnabled`、`timeoutSeconds` |

## 5. 核心规则

1. 授权与定价粒度均基于 `product_id`。
2. 渠道不允许跳过授权直接购买匹配到的商品。
3. 渠道销售价必须大于等于商品采购价。
4. 签名请求的时间窗口默认 5 分钟，超时拒绝。
5. 相同 `Nonce` 在有效期内不可重复使用。
6. 若渠道未配置回调地址，开放下单直接拒绝。

## 6. 下单前校验输出

渠道服务对订单服务提供统一策略查询，至少输出：

- 渠道主体信息
- 商品是否授权
- 渠道售价
- 单笔限额、日限额、QPS 限额结果
- 回调配置快照

## 7. 接口设计

### 7.1 后台 API

- `GET /admin/channels`
- `POST /admin/channels`
- `GET /admin/channel-api-keys`
- `POST /admin/channel-api-keys`
- `POST /admin/channel-products`
- `POST /admin/channel-prices`
- `POST /admin/channel-limits`
- `POST /admin/channel-callback-configs`

### 7.2 开放 API

- `GET /open-api/channel/profile`
- `GET /open-api/channel/quota`

所有开放接口必须使用：

- `AccessKey`
- `Sign`
- `Timestamp`
- `Nonce`

### 7.3 内部能力

- `GET /internal/channels/:channelId/order-policy?productId=...`
- `GET /internal/channels/:channelId/callback-config`

## 8. 数据设计建议

- `channel.channels`
- `channel.channel_api_credentials`
- `channel.channel_product_authorizations`
- `channel.channel_price_policies`
- `channel.channel_limit_rules`
- `channel.channel_callback_configs`

## 9. 异常处理

- 渠道禁用：拒绝访问开放接口。
- 鉴权失败：记录失败日志并拒绝。
- 商品未授权：拒绝下单。
- 金额超限：拒绝下单。
- QPS 超限：直接限流。

## 10. 验收标准

1. 渠道可按单层主体创建与维护。
2. 开放 API 签名成功与失败场景均可验证。
3. 渠道授权、定价、限额能在下单前生效。
4. 渠道未配置回调地址时不能下单。
5. 渠道可查询自身档案与额度信息。

## 11. 明确不做

- 渠道门户登录。
- 多币种价格体系。
- 多级自动分润计算。
- 渠道审批流。
