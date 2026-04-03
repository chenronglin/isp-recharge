# 供应商服务模块详细设计

## 模块职责

- 管理供应商主数据、配置、目录同步、适配器执行、回调解析、日志与健康治理。
- 对订单服务输出统一的标准供应商事件。

## 核心表

- `supplier.suppliers`
- `supplier.supplier_configs`
- `supplier.supplier_orders`
- `supplier.supplier_request_logs`
- `supplier.supplier_callback_logs`
- `supplier.supplier_reconcile_diffs`

## 核心接口

- `GET /admin/suppliers`
- `GET /admin/suppliers/:supplierId/balance`
- `POST /admin/suppliers/:supplierId/catalog/sync`
- `GET /admin/suppliers/:supplierId/sync-logs`
- `GET /admin/suppliers/reconcile-diffs`
- `POST /admin/suppliers/:supplierId/recover-circuit-breaker`
- `POST /admin/supplier-configs`
- `POST /internal/suppliers/orders/submit`
- `POST /internal/suppliers/orders/query`
- `POST /internal/suppliers/catalog/full-sync`
- `POST /internal/suppliers/catalog/delta-sync`
- `POST /internal/suppliers/reconcile/orders`
- `POST /callbacks/suppliers/:supplierCode`

## 关键规则

- 新供应商必须通过代码适配并由种子或配置固化主数据。
- 供应商服务不直接改订单主表。
- 回调与轮询统一输出标准状态。

## 测试重点

- 提交后会先进入受理状态，再由查询任务推进。
- 供应商失败时会触发退款链路。
- 重复回调不会重复推进订单终态。
