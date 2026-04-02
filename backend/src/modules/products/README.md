# 商品服务模块详细设计

## 模块职责

- 管理商品分类、SPU、SKU、静态供应商映射。
- 提供下单所需的全局可售校验、快照与候选供应商快照。

## 核心表

- `product.product_categories`
- `product.products`
- `product.product_skus`
- `product.sku_supplier_mappings`
- `product.product_change_logs`

## 核心接口

- `GET /admin/products`
- `POST /admin/products`
- `POST /admin/product-skus`
- `POST /admin/product-supplier-mappings`
- `GET /open-api/products`
- `GET /internal/products/skus/:skuId/saleability`
- `GET /internal/products/skus/:skuId/snapshot`

## 关键规则

- 商品服务只负责全局可售，不负责渠道授权。
- 订单创建时必须使用商品快照。

## 测试重点

- 商品下架时不能创建新订单。
- SKU 无供应商映射时返回不可售。
- 快照字段完整。
