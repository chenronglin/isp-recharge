# 商品服务模块详细设计

## 模块职责

- 管理充值商品主数据、销售状态与供应商映射。
- 提供下单所需的全局可售校验、快照与候选供应商快照。

## 核心表

- `product.recharge_products`
- `product.product_supplier_mappings`
- `product.product_sync_logs`

## 核心接口

- `GET /admin/products`
- `POST /admin/products`
- `PUT /admin/products/:productId`
- `GET /open-api/products`
- `GET /internal/products/recharge/match`

## 关键规则

- 商品服务只负责全局可售，不负责渠道授权。
- 订单创建时必须使用商品快照。
- 动态同步失效时必须进入 `库存维护`。

## 测试重点

- 商品下架时不能创建新订单。
- 商品无供应商映射时返回不可售。
- 快照字段完整。
