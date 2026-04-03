# 风控服务模块详细设计

## 模块职责

- 负责同步预检、黑白名单、金额规则、频控规则与风险事件留痕。

## 核心表

- `risk.risk_rules`
- `risk.risk_black_white_list`
- `risk.risk_signals`
- `risk.risk_decisions`

## 核心接口

- `GET /admin/risk/rules`
- `POST /admin/risk/rules`
- `GET /admin/risk/black-white-lists`
- `POST /admin/risk/black-white-lists`
- `GET /admin/risk/decisions`
- `POST /internal/risk/pre-check`

## 关键规则

- 风控服务只输出决策，不直接改订单终态。
- 白名单优先于普通规则。
- 风控结果仅允许 `PASS / REJECT`。

## 测试重点

- 金额超阈值直接拒绝。
- 黑名单命中直接拦截。
- 风险决策会落库。
