# 风控服务模块详细设计

## 模块职责

- 负责同步预检、黑白名单、金额规则、人工审核骨架与风险事件留痕。

## 核心表

- `risk.risk_rules`
- `risk.risk_black_white_list`
- `risk.risk_signals`
- `risk.risk_decisions`
- `risk.risk_review_cases`

## 核心接口

- `GET /admin/risk/rules`
- `POST /admin/risk/rules`
- `GET /admin/risk/black-white-lists`
- `POST /internal/risk/pre-check`

## 关键规则

- 风控服务只输出决策，不直接改订单终态。
- 白名单优先于普通规则。

## 测试重点

- 金额超阈值进入审核。
- 黑名单命中直接拦截。
- 风险决策会落库。
