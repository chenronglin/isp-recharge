# 《风控服务详细 PRD》

## 1. 文档定位

风控服务负责同步预检与直接拦截，只输出 `PASS` 或 `REJECT`，不做人审流转。

## 2. 职责边界

### 2.1 负责内容

- 黑白名单。
- 金额阈值。
- 基础频控。
- 风险决策落库。

### 2.2 不负责内容

- 人工审核。
- 审核工作台。
- 订单终态修改。

## 3. 核心对象

| 对象 | 关键字段 |
|---|---|
| RiskRule | `ruleCode`、`ruleType`、`configJson`、`priority` |
| BlackWhiteList | `entryType`、`targetValue`、`listType` |
| RiskDecision | `orderNo`、`channelId`、`decision`、`reason`、`hitRules` |

## 4. 决策模型

### 4.1 输出结果

- `PASS`
- `REJECT`

### 4.2 推荐规则

1. 渠道白名单优先放行。
2. 渠道黑名单直接拒绝。
3. 手机号黑名单直接拒绝。
4. IP 黑名单直接拒绝。
5. 金额超过阈值直接拒绝。
6. 同一渠道、同一手机号短时间重复高频请求直接拒绝。

## 5. 核心规则

1. 风控必须在扣款前执行。
2. 风控结果必须落库。
3. 不返回 `REVIEW`。
4. 风控拒绝不创建订单、不扣减余额。

## 6. 接口设计

### 6.1 后台 API

- `GET /admin/risk/rules`
- `POST /admin/risk/rules`
- `GET /admin/risk/black-white-lists`
- `POST /admin/risk/black-white-lists`
- `GET /admin/risk/decisions`

### 6.2 内部 API

- `POST /internal/risk/pre-check`

## 7. 数据设计建议

- `risk.risk_rules`
- `risk.risk_black_white_list`
- `risk.risk_decisions`
- `risk.risk_signals`

## 8. 异常处理

- 风控服务超时：默认拒绝，并打系统异常标签。
- 规则冲突：按优先级执行，白名单高于普通规则。

## 9. 验收标准

1. 黑名单命中可直接拒单。
2. 白名单可优先放行。
3. 风险决策可查询、可追溯。
4. 风控服务异常时系统不放开高风险请求。

## 10. 明确不做

- 人工复核。
- 风险评分模型。
- 机器学习策略。
