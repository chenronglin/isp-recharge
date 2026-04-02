# 结算与账务服务模块详细设计

## 模块职责

- 维护账户、流水与退款冲正。
- 作为平台资金唯一归口，为支付和订单主链路提供资金事实。

## 核心表

- `ledger.accounts`
- `ledger.account_ledgers`

## 核心接口

- `GET /admin/accounts`
- `GET /admin/ledger-entries`
- `POST /internal/settlement/accounts/freeze`
- `POST /internal/settlement/accounts/unfreeze`

## 关键规则

- 所有资金变化必须写流水。
- 账务流水不可物理删除，只能冲正。

## 测试重点

- 余额支付成功会正确扣减渠道余额并增加平台余额。
- 退款成功会生成冲正流水。
- 同一引用动作不会重复记账。
