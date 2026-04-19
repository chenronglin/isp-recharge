# BACKEND_REQ.md：后台开发需求（admin + 渠道自助端）

## 1. 背景说明

本需求用于支撑以下两类前端能力：

1. `admin 后台`：供应商管理、渠道管理、充值记录、产品快照、订单运营、财务查询、监控与审计。
2. `渠道自助端`：下游渠道登录后进行商品查询、单笔充值、批量充值、订单查询、客户查询、导出、余额查看。

当前仓库中的 [api.json](./api.json) 已经定义了部分后台接口，但整体仍存在以下问题：

- 部分核心域已有接口，但字段不足，无法满足新页面开发。
- 部分接口只有路径和少量入参，没有返回结构、错误码和状态枚举，前端无法稳定联调。
- 仍缺失供应商主数据、充值记录、渠道自助端认证、批量充值、客户中心、导出、拆单策略等能力。

本文档作为后端开发需求说明，供后端工程师评估、排期和实现。

## 2. 当前后台能力盘点

### 2.1 已提供且可复用的接口

以下接口已具备较好的基础能力，可在本次开发中复用：

- `GET/POST /admin/channels`
- `GET /admin/channels/{channelId}`
- `GET /admin/channels/{channelId}/api-keys`
- `POST /admin/channel-api-keys`
- `POST /admin/channel-products`
- `POST /admin/channel-prices`
- `POST /admin/channel-limits`
- `POST /admin/channel-callback-configs`
- `GET /admin/channels/{channelId}/callback-config`
- `GET /admin/channels/{channelId}/order-policy`
- `POST /admin/channels/{channelId}/recharge`
- `GET/POST /admin/products`
- `GET/PUT /admin/products/{productId}`
- `GET /admin/orders/`
- `GET /admin/orders/{orderNo}`
- `GET /admin/orders/{orderNo}/events`
- `POST /admin/orders/{orderNo}/close`
- `POST /admin/orders/{orderNo}/mark-exception`
- `POST /admin/orders/{orderNo}/remarks`
- `POST /admin/orders/{orderNo}/retry-notify`
- `GET /admin/accounts`
- `GET /admin/accounts/{accountId}`
- `GET /admin/ledger-entries`
- `GET /admin/ledger-entries/{entryId}`
- `GET /admin/notifications/tasks`
- `GET /admin/notifications/tasks/{taskNo}`
- `GET /admin/notifications/tasks/{taskNo}/delivery-logs`
- `POST /admin/notifications/tasks/{taskNo}/retry`
- `GET /admin/notifications/dead-letters`
- `GET /admin/audit-logs`
- `POST /internal/suppliers/orders/submit`
- `POST /internal/suppliers/orders/query`
- `POST /internal/suppliers/catalog/full-sync`
- `POST /internal/suppliers/catalog/delta-sync`
- `GET /internal/products/recharge/match`

### 2.2 已有但需要增强的接口

以下接口已存在，但无法直接满足本次需求：

#### 渠道相关

- `POST /admin/channels`
  - 现状：仅支持 `channelCode`、`channelName`、`channelType`
  - 问题：缺联系人、接口地址、协议、接入账号、密码、合作状态、消费日志配置等字段
- `GET /admin/channels/{channelId}`
  - 现状：返回字段较少
  - 问题：无法支撑“渠道基本信息”页面完整展示
- `POST /admin/channels/{channelId}/recharge`
  - 现状：只支持充值动作
  - 问题：未形成“充值记录”语义接口，也未明确与账务流水的关联关系

#### 订单相关

- `GET /admin/orders/`
  - 现状：支持基础筛选和分页
  - 问题：缺 `supplierId`、`carrierCode`、`faceValue`、`operatorUserId` 等筛选条件
- `GET /admin/orders/{orderNo}`
  - 现状：支持详情展示
  - 问题：未覆盖“人工改态 / 状态刷新 / 失败重充”业务动作需要的上下文

#### 财务相关

- `GET /admin/accounts`
  - 现状：支持账户余额查询
  - 问题：缺 `ownerType`、`ownerId` 等明确筛选能力，无法直接支撑“供应商余额 / 渠道余额”视图
- `GET /admin/ledger-entries`
  - 现状：支持通用流水查询
  - 问题：缺 `supplierId`、`rechargeType`、`recordSource` 等充值记录相关维度

#### 开放接口相关

- `GET /open-api/products/`
- `POST /open-api/orders/`
- `GET /open-api/orders/{orderNo}`
- `GET /open-api/orders/{orderNo}/events`
- `GET /open-api/channel/profile`
- `GET /open-api/channel/quota`

问题如下：

- 没有浏览器端友好的登录态体系，前端不能直接安全使用签名式开放接口。
- 返回结构在 `api.json` 中缺失，前端无法据此开发稳定类型。
- 缺少渠道自助端订单列表、批量充值、客户中心、导出等接口。

### 2.3 明确缺失的接口能力

以下能力在现有 `api.json` 中未找到可直接复用的接口：

- 供应商新增接口
- 供应商详情接口
- 供应商编辑接口
- 供应商健康检查接口
- 供应商余额刷新接口
- 供应商消费日志接口
- 供应商产品快照查询接口
- 供应商充值记录查询接口
- 供应商充值记录新增接口
- 渠道编辑接口
- 渠道产品列表查询接口
- 渠道余额查询接口
- 渠道充值记录查询接口
- admin 订单状态刷新接口
- admin 订单失败重充接口
- admin 订单人工改态接口
- 渠道自助端登录态接口
- 渠道自助端订单列表接口
- 渠道自助端订单状态刷新接口
- 渠道自助端批量充值接口
- 渠道自助端批量导入接口
- 批量任务详情与明细接口
- 客户列表接口
- 客户详情接口
- 客户导出接口
- 订单导出接口
- 日志导出接口
- 拆单策略管理接口
- 拆单预览接口

### 2.4 契约不完整、必须补齐文档的现有接口

以下接口在 `api.json` 中已存在，但缺失完整 `response schema`，必须在后端交付前补齐：

- `GET /admin/suppliers`
- `GET /admin/suppliers/reconcile-diffs`
- `GET /admin/suppliers/{supplierId}/balance`
- `POST /admin/suppliers/{supplierId}/catalog/sync`
- `POST /admin/suppliers/{supplierId}/recover-circuit-breaker`
- `GET /admin/suppliers/{supplierId}/sync-logs`
- `POST /admin/supplier-configs`
- `GET /internal/products/recharge/match`
- `GET /admin/jobs/`
- `GET /admin/jobs/{jobId}`
- `POST /admin/jobs/{jobId}/retry`
- `POST /admin/jobs/{jobId}/cancel`
- `GET /admin/jobs/dead-letters`
- `GET /open-api/products/`
- `POST /open-api/orders/`
- `GET /open-api/orders/{orderNo}`
- `GET /open-api/orders/{orderNo}/events`
- `GET /open-api/channel/profile`
- `GET /open-api/channel/quota`

## 3. 后端开发需求

## 3.1 Admin：供应商主数据

### 需要新增/增强的接口

- `POST /admin/suppliers`
- `GET /admin/suppliers/{supplierId}`
- `PUT /admin/suppliers/{supplierId}`
- `GET /admin/suppliers`

### 必须支持的字段

- `supplierId`
- `supplierCode`
- `supplierName`
- `contactName`
- `contactPhone`
- `contactEmail`
- `baseUrl`
- `protocolType`
- `credentialMode`
- `accessAccount`
- `accessPassword`
- `cooperationStatus`
- `supportsBalanceQuery`
- `supportsRechargeRecords`
- `supportsConsumptionLog`
- `remark`
- `healthStatus`
- `lastHealthCheckAt`
- `createdAt`
- `updatedAt`

### 说明

- `accessPassword` 仅允许在入参中明文提交。
- 出参必须脱敏，如返回 `******` 或返回 `credentialId`，不能回显原文密码。
- 列表接口至少支持按 `keyword`、`cooperationStatus`、`healthStatus`、`protocolType` 分页筛选。

## 3.2 Admin：供应商配置、监控与产品快照

### 需要新增/增强的接口

- 增强 `POST /admin/supplier-configs`
- 新增 `GET /admin/suppliers/{supplierId}/health`
- 新增 `POST /admin/suppliers/{supplierId}/balance/refresh`
- 新增 `GET /admin/suppliers/{supplierId}/consumption-logs`
- 增强 `GET /admin/suppliers/{supplierId}/balance`
- 增强 `GET /admin/suppliers/{supplierId}/sync-logs`
- 增强 `GET /admin/suppliers/reconcile-diffs`
- 新增 `GET /admin/suppliers/{supplierId}/products`

### 供应商配置接口要求

- `POST /admin/supplier-configs` 需要返回完整配置结果，而不是只返回操作成功。
- 配置项至少包含：
  - `supplierId`
  - `timeoutMs`
  - `credential`
  - `callbackSecret`
  - `configJson`
  - `updatedAt`
  - `updatedBy`

### 供应商余额接口要求

- `GET /admin/suppliers/{supplierId}/balance` 返回至少包含：
  - `supplierId`
  - `balanceAmountFen`
  - `currency`
  - `balanceStatus`
  - `sourceType`
  - `queriedAt`
  - `rawPayload`
- `POST /admin/suppliers/{supplierId}/balance/refresh` 用于主动刷新余额，并返回最新余额快照。

### 供应商健康检查接口要求

- `GET /admin/suppliers/{supplierId}/health` 返回至少包含：
  - `supplierId`
  - `healthStatus`
  - `httpStatus`
  - `message`
  - `lastSuccessAt`
  - `lastFailureAt`
  - `checkedAt`

### 供应商消费日志接口要求

- `GET /admin/suppliers/{supplierId}/consumption-logs` 仅对支持消费日志的供应商开放。
- 至少支持按 `startTime`、`endTime`、`mobile`、`orderNo`、`supplierOrderNo` 分页筛选。
- 返回至少包含：
  - `id`
  - `supplierId`
  - `mobile`
  - `orderNo`
  - `supplierOrderNo`
  - `amountFen`
  - `status`
  - `occurredAt`
  - `rawPayload`

### 供应商产品快照接口要求

- `GET /admin/suppliers/{supplierId}/products` 直接面向 `supplier_product_snapshots` 视图能力。
- 至少支持按以下条件筛选：
  - `carrierCode`
  - `province`
  - `faceValue`
  - `status`
  - `updatedStartTime`
  - `updatedEndTime`
- 返回至少包含：
  - `snapshotId`
  - `supplierId`
  - `supplierCode`
  - `supplierProductCode`
  - `productName`
  - `carrierCode`
  - `province`
  - `faceValue`
  - `costPriceFen`
  - `saleStatus`
  - `stockStatus`
  - `arrivalSla`
  - `rechargeRange`
  - `updatedAt`
  - `rawPayload`

## 3.3 Admin：供应商充值记录

### 需要新增的接口

- `GET /admin/suppliers/{supplierId}/recharge-records`
- `POST /admin/suppliers/{supplierId}/recharge-records`

### 业务要求

- 支持两种来源：
  - `API_SYNC`：由供应商接口同步获取
  - `MANUAL_INPUT`：由管理员人工录入
- 支持记录审核与追踪信息。

### 查询接口字段

- `recordId`
- `supplierId`
- `rechargeType`
- `amountFen`
- `currency`
- `beforeBalanceFen`
- `afterBalanceFen`
- `recordSource`
- `supplierTradeNo`
- `remark`
- `rawPayload`
- `status`
- `operatorUserId`
- `operatorUsername`
- `createdAt`

### 新增接口要求

- 人工录入时必须记录操作人和备注。
- 若来源为接口拉取，则需记录原始报文快照和同步时间。

## 3.4 Admin：渠道主数据

### 需要新增/增强的接口

- 增强 `POST /admin/channels`
- 增强 `GET /admin/channels/{channelId}`
- 新增 `PUT /admin/channels/{channelId}`

### 必须支持的字段

- `channelId`
- `channelCode`
- `channelName`
- `channelType`
- `contactName`
- `contactPhone`
- `contactEmail`
- `baseUrl`
- `protocolType`
- `accessAccount`
- `accessPassword`
- `cooperationStatus`
- `supportsConsumptionLog`
- `settlementMode`
- `status`
- `remark`
- `createdAt`
- `updatedAt`

### 说明

- 渠道字段应与供应商主数据尽量同构，便于前端表单与详情页复用。
- `accessPassword` 出参必须脱敏。

## 3.5 Admin：渠道产品、余额与充值记录

### 需要新增/增强的接口

- 新增 `GET /admin/channels/{channelId}/products`
- 新增 `GET /admin/channels/{channelId}/balance`
- 新增 `GET /admin/channels/{channelId}/recharge-records`
- 增强 `POST /admin/channels/{channelId}/recharge`

### 渠道产品列表要求

- 返回至少包含：
  - `channelId`
  - `productId`
  - `productName`
  - `carrierCode`
  - `province`
  - `faceValue`
  - `salePriceFen`
  - `authorized`
  - `routeSupplierId`
  - `routeSupplierName`
  - `latestSnapshotAt`
  - `status`

### 渠道余额接口要求

- `GET /admin/channels/{channelId}/balance` 返回至少包含：
  - `channelId`
  - `availableBalanceFen`
  - `frozenBalanceFen`
  - `currency`
  - `status`
  - `updatedAt`

### 渠道充值记录接口要求

- `GET /admin/channels/{channelId}/recharge-records` 返回至少包含：
  - `recordId`
  - `channelId`
  - `amountFen`
  - `beforeBalanceFen`
  - `afterBalanceFen`
  - `recordSource`
  - `remark`
  - `operatorUserId`
  - `createdAt`

### 充值动作要求

- `POST /admin/channels/{channelId}/recharge` 保留现有语义。
- 每次充值都必须：
  - 写入充值记录
  - 写入账务流水
  - 与账户余额变动保持一致
  - 写入审计日志

## 3.6 Admin：订单管理增强

### 需要增强/新增的接口

- 增强 `GET /admin/orders/`
- 新增 `POST /admin/orders/{orderNo}/refresh-status`
- 新增 `POST /admin/orders/{orderNo}/retry-recharge`
- 新增 `POST /admin/orders/{orderNo}/manual-status`

### 列表筛选增强要求

`GET /admin/orders/` 至少补充以下筛选条件：

- `supplierId`
- `carrierCode`
- `faceValue`
- `operatorUserId`

### 订单动作要求

- `POST /admin/orders/{orderNo}/refresh-status`
  - 主动向供应商同步最新状态
- `POST /admin/orders/{orderNo}/retry-recharge`
  - 仅允许失败或明确可重试状态的订单执行
- `POST /admin/orders/{orderNo}/manual-status`
  - 仅 admin 可用
  - 必须填写 `targetStatus` 和 `reason`
  - 必须写审计日志
  - 建议记录变更前后状态

## 3.7 渠道自助端：认证与登录态

### 需要新增的接口

- `POST /portal/auth/login`
- `POST /portal/auth/logout`
- `GET /portal/me`

### 业务要求

- 浏览器端不能直接拼开放接口签名，必须提供会话态或 token 型登录接口。
- 所有渠道自助端查询必须基于当前登录渠道自动隔离数据，前端不能传入其他 `channelId` 获取越权数据。

### `GET /portal/me` 返回至少包含

- `channelId`
- `channelCode`
- `channelName`
- `status`
- `roleCodes`
- `permissions`

## 3.8 渠道自助端：商品与拆单策略

### 需要增强/新增的接口

- 增强 `GET /open-api/products/`
- 新增 `POST /open-api/orders/preview-split`
- 新增或扩展 admin 侧拆单策略管理接口

### 商品接口要求

`GET /open-api/products/` 至少支持以下筛选：

- `carrierCode`
- `province`
- `faceValue`
- `productType`
- `status`

返回至少包含：

- `productId`
- `productName`
- `faceValue`
- `salePriceFen`
- `rechargeRange`
- `arrivalSla`
- `carrierCode`
- `operator`
- `routeStatus`
- `splitSupport`

### 拆单策略要求

至少支持以下配置项：

- `allowedFaceValues`
- `preferMaxSingleFaceValue`
- `maxSplitPieces`
- `provinceOverride`
- `carrierOverride`

### 拆单预览接口要求

`POST /open-api/orders/preview-split` 入参至少包含：

- `mobile`
- `faceValue`
- `productType`

返回至少包含：

- `requestedFaceValue`
- `splitResult`
- `totalPieces`
- `matchedProducts`
- `unmatchedReason`

必须覆盖以下场景：

- `380 => 200 + 100 + 50 + 20 + 10`
- 策略关闭时不拆单
- 拆单片数超过上限
- 无可售组合
- 优先单张最大面值

## 3.9 渠道自助端：单笔充值、列表、批量充值

### 保留并增强的接口

- 保留 `POST /open-api/orders/`
- 保留 `GET /open-api/orders/{orderNo}`
- 保留 `GET /open-api/orders/{orderNo}/events`
- 新增 `GET /open-api/orders`
- 新增 `POST /open-api/orders/{orderNo}/refresh-status`

### 订单列表接口要求

`GET /open-api/orders` 至少支持以下筛选：

- `orderNo`
- `channelOrderNo`
- `mobile`
- `startTime`
- `endTime`
- `status`
- `supplierId`
- `faceValue`
- `carrierCode`

返回至少包含：

- `orderNo`
- `channelOrderNo`
- `mobile`
- `carrierCode`
- `faceValueAmountFen`
- `supplierId`
- `supplierName`
- `status`
- `failedReason`
- `createdAt`
- `finishedAt`

### 需要新增的批量能力

- `POST /open-api/orders/batch`
- `POST /open-api/orders/batch-import`
- `GET /open-api/batch-jobs/{jobId}`
- `GET /open-api/batch-jobs/{jobId}/items`
- `GET /open-api/batch-template`

### 批量充值要求

- 支持手工录入多行数据提交。
- 支持文件导入提交。
- 支持失败明细回执。
- 支持复用现有 `jobs` 体系跟踪处理进度。

### 批量任务详情字段

- `jobId`
- `jobType`
- `status`
- `totalCount`
- `successCount`
- `failedCount`
- `createdAt`
- `finishedAt`
- `downloadUrl`

### 批量任务明细字段

- `itemId`
- `mobile`
- `faceValue`
- `status`
- `orderNo`
- `failedReason`
- `createdAt`

## 3.10 渠道自助端：客户中心与导出

### 需要新增的接口

- `GET /open-api/customers`
- `GET /open-api/customers/{mobile}`
- `POST /open-api/customers/export`
- 新增订单导出接口
- 新增日志导出接口

### 客户列表字段要求

- `mobile`
- `carrierCode`
- `firstRechargeAt`
- `lastRechargeAt`
- `rechargeCount`
- `totalRechargeAmountFen`

### 客户列表筛选要求

- `mobile`
- `carrierCode`
- `rechargeCountMin`
- `rechargeCountMax`
- `totalRechargeAmountMin`
- `totalRechargeAmountMax`

### 导出要求

- 客户导出、订单导出、日志导出统一走异步导出任务。
- 返回 `jobId` 和下载地址。
- 导出格式为 Excel。
- 导出任务必须进入 `jobs` 体系，可查询、可重试、可落死信。

## 3.11 通用契约、安全与审计要求

### `api.json` 契约要求

所有新增或增强接口必须同步补齐以下信息：

- `request schema`
- `response schema`
- 错误码
- 状态枚举
- 字段单位说明

### 安全要求

- 密码、密钥、凭证类字段只允许入参明文。
- 所有出参统一脱敏，或返回 `credentialId`。
- 渠道自助端必须强制按登录渠道隔离数据。

### 审计要求

以下动作必须写入 `audit-log`：

- 供应商新增、编辑、配置修改
- 渠道新增、编辑、充值
- 人工录入充值记录
- 订单人工改态
- 订单失败重充
- 导出任务发起

### 异步任务要求

所有批量任务和导出任务必须：

- 进入 `jobs` 体系
- 支持状态查询
- 支持失败重试
- 支持死信查看

## 4. 建议实施顺序

建议按以下顺序实现，便于前端分批联调：

### 第一阶段：补齐 admin 主数据与契约

- 补齐 `admin/suppliers*` 相关能力
- 补齐 `admin/channels` 编辑与扩展字段
- 补齐现有接口的 `response schema`
- 补齐 `jobs` 相关返回结构

### 第二阶段：补齐 admin 业务视图能力

- 供应商产品快照
- 供应商充值记录
- 渠道产品列表
- 渠道余额与充值记录
- admin 订单动作增强

### 第三阶段：交付渠道自助端基础能力

- `portal/auth/*`
- `open-api/products`
- `open-api/orders` 列表与状态刷新
- 拆单预览

### 第四阶段：交付渠道自助端高级能力

- 批量充值
- 文件导入
- 客户中心
- Excel 导出

## 5. 验收与测试要求

后端交付前至少覆盖以下测试场景：

### 5.1 供应商与渠道主数据

- 新增成功
- 编辑成功
- 详情回显完整
- 密码脱敏
- 状态切换
- 健康检查
- 余额刷新

### 5.2 供应商/渠道业务数据

- 产品快照查询
- 目录同步后列表刷新
- 对账差异查询
- 充值记录查询
- 人工补录充值记录
- 渠道商品授权和销售价展示

### 5.3 订单与拆单

- 单笔下单
- 查询详情
- 查询轨迹
- 手动刷新状态
- 失败订单重充
- 人工改态
- `380 = 200 + 100 + 50 + 20 + 10`
- 无法拆单时返回清晰原因

### 5.4 批量与导出

- 批量手工录入
- 批量文件导入
- 失败行回执
- 客户导出
- 订单导出
- 日志导出
- 任务状态查询
- 死信补偿

### 5.5 安全与审计

- 数据隔离
- 越权拦截
- 审计日志完整落库
- 凭证不明文回显

## 6. 默认假设

- 本文档按 `admin 后台 + 渠道自助端` 双端后端需求编写。
- 供应商管理属于 admin 侧。
- 渠道自助端只能访问自身订单、商品、客户、额度与任务。
- “失败订单手动标记状态”默认仅对 admin 开放。
- 供应商/渠道的账号、密码、密钥由后台加密存储，前端永远不回显原文。
- `api.json` 作为前后端联调基准，后端交付前必须补齐完整契约。
