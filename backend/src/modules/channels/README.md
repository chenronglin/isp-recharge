# 渠道服务模块详细设计

## 模块职责

- 管理渠道主体、API Key、商品授权、渠道价格、限额和回调配置。
- 提供开放接口签名校验与下单前策略查询。

## 核心表

- `channel.channels`
- `channel.channel_api_credentials`
- `channel.channel_product_authorizations`
- `channel.channel_price_policies`
- `channel.channel_limit_rules`
- `channel.channel_callback_configs`

## 核心接口

- `GET /admin/channels`
- `POST /admin/channels`
- `POST /admin/channel-api-keys`
- `POST /admin/channel-products`
- `POST /admin/channel-prices`
- `POST /admin/channel-limits`
- `POST /admin/channel-callback-configs`
- `GET /open-api/channel/profile`
- `GET /internal/channels/:channelId/order-policy`

## 关键规则

- 开放接口必须通过 `AccessKey + Sign + Timestamp + Nonce` 校验。
- 渠道价格与商品标准价分离。
- 回调配置在下单时要被快照化。

## 测试重点

- 签名正确和错误场景。
- 渠道禁用时无法访问开放接口。
- 商品未授权与金额超限时阻断下单。
