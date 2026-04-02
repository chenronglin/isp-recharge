# 《商品服务详细 PRD》

## 1. 文档定位

商品服务负责 ISP 话费充值 V1 的商品主数据管理、销售状态管理、参考库存管理以及商品与供应商静态映射管理。

V1 仅维护话费充值商品，不维护流量包、慢充或其他数字商品。

## 2. 职责边界

### 2.1 负责内容

- 话费充值商品主数据维护。
- 商品销售状态维护。
- 商品详情维护。
- 参考库存与动态状态接收。
- 商品与供应商静态映射管理。
- 根据识别后的省份、运营商、面额、充值类型查询候选商品。

### 2.2 不负责内容

- 下单编排。
- 渠道价格与授权校验。
- 供应商提单与查单。
- 订单状态推进。

## 3. 核心对象

### 3.1 Product

| 字段 | 类型 | 说明 |
|---|---|---|
| `product_id` | int/string | 商品 ID |
| `product_name` | string | 商品名称，如“广东移动话费 50 元混充” |
| `province` | string | 归属省份，允许具体省份或 `全国` |
| `ispName` | string | 运营商名称 |
| `face_value` | double | 面额，单位元 |
| `product_type` | string | 业务语义为 `快充`、`混充`；开放接口枚举值为 `FAST`、`MIXED` |
| `purchase_price` | double | 当前采购价 |
| `amount` | int | 参考库存或参考可售量 |
| `sales_status` | string | `下架`、`上架`、`维护中`、`库存维护` |
| `details` | string | 商品详情、到账说明、限制说明 |

### 3.2 SupplierMapping

| 字段 | 说明 |
|---|---|
| `mappingId` | 映射 ID |
| `productId` | 平台商品 ID |
| `supplierId` | 供应商 ID |
| `supplierProductCode` | 供应商商品编码 |
| `priority` | 默认优先级 |
| `status` | `ACTIVE` / `INACTIVE` |
| `lastDynamicSyncAt` | 最近动态同步时间 |
| `lastSuccessRate` | 最近成功率 |
| `lastAvgLatency` | 最近平均耗时 |

## 4. 关键规则

1. 商品最小单元是 `product_id`，不再对外暴露 `skuId`。
2. 同一业务键 `province + ispName + face_value + product_type` 下不允许多个 `上架` 商品同时生效。
3. `product_type` 不传时默认按 `MIXED` 查询。
4. `amount` 仅作参考，不是唯一可售依据。
5. 当动态数据超过 120 分钟未刷新时，商品或映射自动转为 `库存维护`。

## 5. 销售状态定义

| 状态 | 含义 | 是否允许下单 |
|---|---|---|
| `上架` | 正常可售 | 是 |
| `下架` | 主动停售 | 否 |
| `维护中` | 人工维护或供应商维护 | 否 |
| `库存维护` | 同步失效或参考库存异常 | 否 |

## 6. 商品匹配能力

### 6.1 输入

- `province`
- `ispName`
- `faceValue`
- `product_type`

### 6.2 输出

- 命中的平台商品
- 候选供应商映射列表
- 命中依据
- 当前动态同步状态

### 6.3 匹配顺序

1. 优先省内商品。
2. 其次全国商品。
3. 若仍无商品，则返回不可售。

## 7. 同步设计

### 7.1 每天 1 次全量商品同步

同步字段：

- 运营商
- 省份
- 面额
- 充值类型
- 供应商商品编码
- 商品是否存在

### 7.2 每 60 分钟 1 次动态同步

同步字段：

- 销售状态
- 采购价
- 参考库存
- 维护标记

### 7.3 同步失效保护

- 连续两个周期未刷新，则自动切换到 `库存维护`。
- 同步恢复后，需重新通过状态校验后才能恢复 `上架`。

## 8. 接口设计

### 8.1 后台 API

- `GET /admin/products`

说明：

- 当前 V1 后端实际已开放商品查询能力。
- 商品维护类后台接口仍属于后续补齐范围。

### 8.2 开放 API

- `GET /open-api/products`

说明：

- 开放商品列表仅作展示与查询，不作为下单必需依赖。

### 8.3 内部 API

- `GET /internal/products/recharge/match`

## 9. 数据设计建议

- `product.recharge_products`
- `product.product_supplier_mappings`
- `product.product_sync_logs`

实现说明：

- 当前落库口径由 `recharge_products + product_supplier_mappings` 承载。
- 实际可售判断同时依赖 `ACTIVE / ON_SALE / inventory_quantity / dynamic_updated_at`。

## 10. 异常处理

- 业务键重复上架：拒绝发布并报警。
- 商品命中但映射全部不可用：返回不可售。
- 动态同步失败：商品转 `库存维护`。
- 商品已下架但订单引用历史快照：不影响历史订单解释。

## 11. 验收标准

1. 可维护话费充值商品基础字段。
2. 可按省份、运营商、面额、充值类型完成商品匹配。
3. 商品状态能阻断下单。
4. 动态同步失效时商品会自动进入 `库存维护`。
5. 商品列表可供运营查看与导出。

## 12. V1 不做

- 流量包商品。
- 慢充商品。
- 分类树与复杂属性模板。
- 促销、满减、优惠券。
