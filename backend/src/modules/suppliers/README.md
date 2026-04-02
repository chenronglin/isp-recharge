# 供应商服务模块详细设计

## 模块职责

- 管理供应商主数据、配置、适配器执行、回调解析与健康统计。
- 对订单服务输出统一的标准供应商事件。

## 核心表

- `supplier.suppliers`
- `supplier.supplier_configs`
- `supplier.supplier_orders`
- `supplier.supplier_callback_logs`
- `supplier.supplier_health_stats`

## 核心接口

- `GET /admin/suppliers`
- `POST /admin/supplier-configs`
- `POST /internal/suppliers/orders/submit`
- `POST /internal/suppliers/orders/query`
- `POST /callbacks/suppliers/:supplierCode`

## 关键规则

- 新供应商必须通过代码适配并由 seed/迁移固化主数据，不通过后台接口临时创建。
- 供应商服务不直接改订单主表。
- 回调与轮询统一输出标准状态。

## 测试重点

- 提交后会先进入受理状态，再由查询任务推进。
- 模拟供应商失败时会触发退款链路。
- 重复回调不会重复推进订单终态。
