# ISP 话费充值平台 V1 验收比对报告

## 1. 总体结论

基于 `3.1` 至 `3.9` 模块矩阵，当前软件功能已基本覆盖 ISP 话费充值平台 V1 的有效范围。开放下单、商品匹配、渠道鉴权、余额扣款、供应商履约、失败退款、终态通知、基础对账与 Worker 调度主链路均能在现有实现路径、数据库约束与测试源码中形成闭环；当前未发现会直接推翻 V1 主链路验收判断的 P1 实现缺口。

同时，当前并非只剩文档问题。`## 4. 关键缺口清单` 中仍有若干 P2 级实现或证据缺口，包括后台写操作审计覆盖未闭合、商品动态同步失效更偏向“等效不可售”而非显式写回 `库存维护`、基础价差报表与对账闭环证据不足，以及风控异常标签口径未闭合。这些问题尚不足以否定 V1 主链路，但也不足以把当前状态直接表述为“实现层面已完全就绪”。

当前文档也不足以直接支撑正式验收。总设计、部分 PRD 与多个模块 README 仍存在口径冲突、旧模型残留和验收标准强于当前实现说明的情况；若不先统一这些口径，正式验收时会在“单层渠道”“`product_id` 与 `sku`”“风控只输出 `PASS / REJECT`”等关键点上出现判断分歧。

本次证据的主要限制是：当前 worktree 的 `backend` 目录无法现场复跑 `bun test`，直接原因是缺少 `POSTGRES_*` 环境变量。因此，本报告的强证据主要来自实现代码、数据库迁移、路由与服务调用链、测试源码以及模块设计文档，而不是本次现场复跑结果。

## 2. 判定口径

交叉说明：`OpenAPI` 文档、统一响应结构、`CORS` 与 `schema` 测试属于跨模块基础能力，只作为证据增强项，不单独替代业务验收。

## 3. 模块验收矩阵

### 3.1 用户与权限
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 后台管理员可登录并刷新会话 | 已实现 | 强 | `backend/src/modules/iam/iam.service.ts`（`login`/`refresh`）；`backend/src/modules/iam/iam.routes.ts`（`POST /admin/auth/login`、`POST /admin/auth/refresh`）；`backend/tests/iam-login.test.ts`（登录写入会话） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 基础角色可区分运营/财务/风控/支持 | 部分实现 | 中 | `backend/src/modules/iam/iam.service.ts`（`listRoles`、`createRole`、`assignRole`）；`backend/src/modules/iam/iam.repository.ts`（`iam.roles`、`iam.user_role_relations`） | 角色模型已支持按 `roleCode` 区分，但未看到对 `OPS/FINANCE/RISK/SUPPORT` 的固定基线与自动校验测试。 |
| 被停用账号无法继续访问后台接口 | 已实现 | 中 | `backend/src/modules/iam/iam.service.ts`（`requireActiveAdmin`、`refresh` 对 `status !== ACTIVE` 拒绝）；`backend/src/modules/iam/iam.routes.ts`、`backend/src/modules/channels/channels.routes.ts`、`backend/src/modules/products/products.routes.ts`（后台路由统一调用 `requireActiveAdmin`） | 关键拦截在服务层与后台路由均存在；测试源码存在但本次未复跑。 |
| 后台写操作的审计追溯能力 | 部分实现 | 中 | `backend/src/lib/audit.ts`（`writeAuditLog`）；`backend/src/modules/iam/iam.routes.ts`（创建用户/角色写审计）；`backend/src/modules/channels/channels.routes.ts`（创建渠道/凭证写审计） | 审计能力已落地，但不是“所有后台写操作”都覆盖（如渠道授权/定价/限额/回调配置未见审计调用）。 |

### 3.2 渠道
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 开放 API 签名成功与失败场景可验证 | 已实现 | 强 | `backend/src/modules/channels/channels.service.ts`（`authenticateOpenRequest` 校验 `AccessKey/Sign/Timestamp/Nonce`）；`backend/src/modules/channels/channels.routes.ts`（`GET /open-api/channel/profile`）；`backend/tests/channels-limits-v1.test.ts`（首次成功、重复 Nonce 失败）；`backend/tests/security.test.ts`（签名算法稳定性） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 商品授权/定价/限额在下单前生效 | 已实现 | 中 | `backend/src/modules/channels/channels.service.ts`（`getOrderPolicy` 校验授权、价格、单笔/日限额/QPS）；`backend/tests/channels-limits-v1.test.ts`（日限额、QPS、价格下限） | “商品未授权拒单”在代码已实现，但当前证据以实现阅读为主，未复跑用例。 |
| 渠道未配置回调地址时不能下单 | 已实现 | 中 | `backend/src/modules/channels/channels.service.ts`（`getOrderPolicy` 中 `!callbackConfig` 抛出“渠道未配置回调地址”）；`backend/src/modules/channels/channels.routes.ts`（内部下单前策略读取入口） | 代码路径明确，未见独立自动化用例；本次未复跑。 |
| 单层渠道模型与文档一致性 | 文档过期/冲突 | 强 | `docs/渠道服务PRD.md`（3.1 明确 V1 单层；10.1 仍写“按层级创建”）；`backend/src/modules/channels/channels.types.ts`、`backend/src/modules/channels/channels.repository.ts`（无 `parentChannelId` 等层级字段） | 代码实现与“V1 单层”一致，但 PRD 验收条目仍残留多层级口径，属于文档冲突。 |

### 3.3 商品
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 可按省份/运营商/面额/充值类型完成商品匹配 | 已实现 | 强 | `backend/src/modules/products/products.service.ts`（`matchRechargeProduct`）；`backend/src/modules/products/products.repository.ts`（省份优先、全国回退、`carrier_code + face_value + recharge_mode`）；`backend/tests/mobile-matching.test.ts`（默认 MIXED、FAST、省份回退） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 商品状态与动态同步状态可阻断下单 | 已实现 | 中 | `backend/src/modules/products/products.repository.ts`（`recharge_products.status='ACTIVE'`，映射需 `status='ACTIVE'`、`sales_status='ON_SALE'`、库存>0、`dynamic_updated_at` 在 120 分钟内）；`backend/tests/mobile-matching.test.ts`（过期后报“未匹配到可用充值商品”） | 属于“等效实现”：通过匹配过滤阻断不可售，而非在下单接口单独再做一层状态枚举判断。 |
| 动态同步失效时进入库存维护或等效不可售状态 | 部分实现 | 中 | `backend/src/modules/products/products.repository.ts`（120 分钟动态新鲜度过滤）；`backend/tests/mobile-matching.test.ts`（`121 minutes` 后不可匹配） | 当前更接近“等效不可售”，未见自动把商品显式写回 `库存维护` 状态字段的实现证据。 |
| 商品列表可供后台与开放接口查询 | 已实现 | 中 | `backend/src/modules/products/products.routes.ts`（`GET /admin/products`、`GET /open-api/products/`）；`backend/src/modules/products/products.service.ts`（`listProducts`）；`backend/tests/products-listing.test.ts`（开放接口列表） | 开放接口有测试源码；后台列表主要由路由与服务实现证据支撑，当前未复跑。 |

### 3.4 订单
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 基于 `channelId + channelOrderNo` 幂等 | 已实现 | 强 | `backend/src/database/migrations/0001_init_schemas.sql`（`ordering.orders` 唯一约束 `UNIQUE (channel_id, channel_order_no)`）；`backend/src/modules/orders/orders.repository.ts`（`withCreateOrderLock` + `findByChannelOrder`）；`backend/tests/orders.service.test.ts`（`returns the existing order when a concurrent duplicate insert hits the unique key`） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 下单固化识别结果、商品/渠道/供应商快照与 SLA | 部分实现 | 中 | `backend/src/modules/orders/orders.service.ts`（`createOrder` 写入 `channel/product/callback/supplierRoute/risk` 快照并派生 `warningDeadlineAt`/`expireDeadlineAt`）；`backend/src/modules/orders/orders.repository.ts`（快照字段落库）；`backend/tests/order-flow-v1.test.ts`（`开放接口使用 ... 创建订单并走余额扣款`） | 识别结果与多类快照已固化；SLA 以预警/过期时点字段等效实现，未见独立 `slaSnapshot` 字段。测试未复跑。 |
| `FAST` / `MIXED` 超时规则分别生效 | 已实现 | 强 | `backend/src/modules/orders/orders.schema.ts`（`product_type` 仅允许 `FAST|MIXED`）；`backend/src/modules/orders/orders.repository.ts`（`requestedProductType` 非 `FAST` 映射为 `MIXED`）；`backend/src/modules/orders/orders.service.ts`（`matched.product.productType === 'FAST'` 分支派生 `10/60` vs `150/180` 分钟并由 `scanTimeouts` 生效）；`backend/tests/order-timeout-v1.test.ts`（`FAST...`、`MIXED...`） | `MIXED` 依据已在请求枚举、持久化映射与 SLA 分支中显式闭合；测试本次未复跑。 |
| 失败会自动触发退款 | 已实现 | 强 | `backend/src/modules/orders/orders.service.ts`（`handleSupplierFailed`、`scanTimeouts`、`compensateInitialSubmitEnqueueFailure` 调用 `ledgerContract.refundOrderAmount`）；`backend/tests/order-flow-v1.test.ts`（`供应商失败后会退款并进入 REFUNDED`）；`backend/tests/order-timeout-v1.test.ts`（超时退款链路） | 代码路径与测试源码均明确；未复跑。 |
| 晚到回调不会逆转终态 | 已实现 | 强 | `backend/src/modules/orders/orders.service.ts`（`handleSupplierSucceeded` 对 `REFUNDED+SUCCESS` 仅标记 `LATE_CALLBACK_EXCEPTION`）；`backend/tests/order-flow-v1.test.ts`（`已退款订单收到供应商成功会标记 LATE_CALLBACK_EXCEPTION`）；`backend/tests/order-timeout-v1.test.ts`（`...迟到成功不会把订单重新推进为 SUCCESS`） | 现有实现是“记异常不回滚终态”；测试未复跑。 |

### 3.5 供应商
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 商品全量/动态同步已落地 | 已实现 | 强 | `backend/src/modules/suppliers/suppliers.service.ts`（`syncFullCatalog`、`syncDynamicCatalog`）；`backend/src/modules/suppliers/suppliers.repository.ts`（`upsertProductSupplierMapping`、`updateDynamicCatalogItem`、`deactivateProductSupplierMapping`）；`backend/tests/supplier-sync-v1.test.ts`（动态与全量同步用例） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 提单、查单、回调解析已落地 | 已实现 | 强 | `backend/src/modules/suppliers/suppliers.service.ts`（`submitOrder`、`queryOrder`、`handleSupplierCallback` + `adapter.parseCallback`）；`backend/src/app.ts`（`registerHandler('supplier.submit')`、`registerHandler('supplier.query')`）；`backend/src/modules/worker/worker.types.ts`（`workerJobTypes` 含 `supplier.submit`/`supplier.query`）；`backend/src/modules/suppliers/suppliers.routes.ts`（`/internal/suppliers/orders/submit|query`、`/callbacks/suppliers/:supplierCode`）；`backend/tests/order-flow-v1.test.ts`（有效/无效回调验签与状态推进） | Worker 入口、任务类型与供应商处理链路可相互对齐形成闭环；测试未复跑。 |
| 在途对账与日对账已落地 | 已实现 | 强 | `backend/src/modules/suppliers/suppliers.service.ts`（`runInflightReconcile`、`runDailyReconcile`）；`backend/src/modules/suppliers/suppliers.repository.ts`（`listReconcileCandidates`、`upsertReconcileDiff`）；`backend/src/database/migrations/0001_init_schemas.sql`（唯一索引 `uq_supplier_reconcile_diffs_dedupe`）；`backend/tests/supplier-reconcile-v1.test.ts`（在途差异、日对账差异、重复执行去重） | 对账差异写入与 `uq_supplier_reconcile_diffs_dedupe` 去重约束一致构成闭环；测试未复跑。 |
| 模拟供应商路径可支撑 V1 验收 | 已实现 | 强 | `backend/src/modules/suppliers/adapters/mock-supplier.adapter.ts`（`mock-auto-success`/`mock-auto-fail`、`submit/query/parseCallback`）；`backend/src/modules/suppliers/suppliers.service.ts`（`getAdapter` 对 `mock-supplier` 路由）；`backend/tests/order-flow-v1.test.ts`（`setMockSupplierMode` 覆盖成功/失败链路） | V1 联调路径主要依赖 mock 适配器，证据充分但本次未复跑。 |

### 3.6 结算与账务
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 可按渠道校验余额并扣款 | 已实现 | 强 | `backend/src/modules/ledger/ledger.service.ts`（`ensureBalanceSufficient`、`debitOrderAmount`）；`backend/src/modules/orders/orders.service.ts`（下单先校验余额再扣款）；`backend/tests/order-flow-v1.test.ts`（创建订单扣款流水、余额不足拒单） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 失败订单可自动退款并冲正 | 已实现 | 强 | `backend/src/modules/orders/orders.service.ts`（供应商失败/超时触发 `refundOrderAmount`）；`backend/src/modules/ledger/ledger.service.ts`（`refundOrderAmount` 反向转账）；`backend/tests/order-flow-v1.test.ts`、`backend/tests/order-timeout-v1.test.ts`（`ORDER_REFUND` 流水） | 退款动作通过账务流水落地，测试未复跑。 |
| 同一订单不会重复退款 | 已实现 | 强 | `backend/src/modules/ledger/ledger.service.ts`（`findLedgerByOrderAction(orderNo, 'ORDER_REFUND')` 幂等返回）；`backend/src/modules/ledger/ledger.repository.ts`（`transferBalance` 事务锁 + 再查重）；`backend/tests/order-timeout-v1.test.ts`（`...避免重复退款`） | 当前幂等键基于 `orderNo + ORDER_REFUND` 的等效实现；测试未复跑。 |
| 基础价差可用于报表与对账 | 部分实现 | 中 | `backend/src/modules/ledger/ledger.service.ts`（`confirmOrderProfit` 写 `ORDER_PROFIT`）；`backend/src/modules/ledger/ledger.routes.ts`（`GET /admin/ledger-entries`）；`backend/tests/order-flow-v1.test.ts`（成功链路包含 `ORDER_PROFIT`） | 已有基础价差流水与查询接口；未见专门“报表/对账口径”聚合实现与验收测试，属于部分闭环。 |

### 3.7 风控
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 黑名单命中可直接拒单 | 已实现 | 强 | `backend/src/modules/risk/risk.service.ts`（`preCheck` 命中 `BLACK_CHANNEL/BLACK_IP/BLACK_MOBILE` 返回 `REJECT`）；`backend/tests/risk-v1.test.ts`（`手机号黑名单命中返回 REJECT 并落风险决策`） | 测试源码存在，但当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 白名单可优先放行 | 已实现 | 中 | `backend/src/modules/risk/risk.service.ts`（`preCheck` 先判断 `WHITE` 渠道并直接 `PASS`，后续才执行黑名单与规则） | 代码实现可证明白名单优先；当前未见独立“白名单放行”自动化用例；当前 worktree 未复跑风险用例（缺少 `POSTGRES_*` 环境变量）。 |
| 风险决策可查询、可追溯 | 已实现 | 强 | `backend/src/modules/risk/risk.repository.ts`（`addDecision` 落库 `risk_decisions`，`listDecisions` 返回 `hitRules/context`）；`backend/src/modules/risk/risk.routes.ts`（`GET /admin/risk/decisions`）；`backend/tests/risk-v1.test.ts`（`后台可创建黑白名单并查询风险决策`） | 决策查询与上下文追溯字段均存在；测试未复跑。 |
| 风控异常时不放开高风险请求 | 部分实现 | 中 | `backend/src/modules/orders/orders.service.ts`（`createOrder` 中 `await riskContract.preCheck`，非 `PASS` 直接拒绝；异常向上抛出并中断下单）；`backend/src/modules/risk/risk.service.ts`（当前仅返回 `PASS/REJECT`，未见“超时系统异常标签”落库逻辑） | 已有等效实现：`preCheck` 非 `PASS` 或异常都会中断下单，不会放行；仍缺点：PRD 提到的“超时默认拒绝 + 系统异常标签”缺少直接实现与测试证据。测试未复跑。 |

### 3.8 通知
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 成功订单可触发成功通知 | 已实现 | 中 | `backend/src/modules/orders/orders.service.ts`（`handleSupplierSucceeded` 发布 `eventBus.publish('NotificationRequested', triggerReason: 'ORDER_SUCCESS')`）；`backend/src/app.ts`（订阅 `NotificationRequested` 并转入 `notifications.handleNotificationRequested`）；`backend/src/modules/notifications/notifications.service.ts`（`triggerReason='ORDER_SUCCESS'` 且订单 `mainStatus='SUCCESS'` 时创建并入队 `notification.deliver`） | 代码链路完整；当前所列测试主要覆盖重试/投递，不是“成功订单触发创建通知”的独立端到端用例；这些测试源码当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| 退款订单可触发退款通知 | 已实现 | 中 | `backend/src/modules/orders/orders.service.ts`（`handleRefundSucceeded` 发布 `eventBus.publish('NotificationRequested', triggerReason: 'REFUND_SUCCEEDED')`）；`backend/src/app.ts`（订阅 `NotificationRequested` 并转入 `notifications.handleNotificationRequested`）；`backend/src/modules/notifications/notifications.service.ts`（`triggerReason='REFUND_SUCCEEDED'` 需 `mainStatus='REFUNDED'` 且 `refundStatus='SUCCESS'` 才创建通知） | 触发链路与创建条件实现已闭环；当前缺少“退款通知创建”直接自动化用例，且相关测试源码当前 worktree 未复跑（缺少 `POSTGRES_*` 环境变量）。 |
| Webhook 失败后会自动重试 | 已实现 | 强 | `backend/src/modules/notifications/notifications.service.ts`（`handleDeliverJob` 失败后 `markRetry` 并抛 `retryable` 错误）；`backend/tests/notifications-retry-v1.test.ts`（`worker path schedules full six-window retry tiers then dead-letters on boundary`、`manual retry keeps notification and worker next run times aligned`） | 重试窗口、`nextRetryAt` 与 worker `nextRunAt` 对齐均有测试源码；当前未复跑。 |
| 超过重试次数的任务会进入死信 | 已实现 | 强 | `backend/src/modules/notifications/notifications.service.ts`（达到 `maxAttempts` 调用 `markDeadLetter`）；`backend/src/modules/notifications/notifications.repository.ts`（写入 `notification.notification_dead_letters`）；`backend/tests/notifications-retry-v1.test.ts`（最终 `DEAD_LETTER` 且死信计数为 1） | 死信落表与状态收敛路径明确；测试未复跑。 |

### 3.9 Worker 任务系统
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
| 任务按 `jobType + businessKey` 去重 | 已实现 | 中 | `backend/src/modules/worker/worker.service.ts`（`enqueue/schedule` 先按 `jobType + businessKey` 查询已存在任务并复用/重排）；`backend/src/modules/worker/worker.repository.ts`（`findByJobTypeAndBusinessKey`）；`backend/tests/worker-scheduler-v1.test.ts`（`bootstrapping recurring schedules twice keeps jobs singleton`） | 去重逻辑在服务层闭环；并发领取能力由 `backend/tests/worker-claiming.test.ts`（`并发 claimReady 不会让同一个 READY 任务被领取两次`）补充佐证。测试未复跑。 |
| 失败任务会自动重试 | 已实现 | 强 | `backend/src/modules/worker/worker.service.ts`（`processReadyJobs` 失败分支按退避转 `RETRY_WAIT`）；`backend/src/modules/worker/worker.repository.ts`（`markRetry`）；`backend/tests/notifications-retry-v1.test.ts`（`worker path schedules full six-window retry tiers then dead-letters on boundary`、`manual retry keeps notification and worker next run times aligned`、`successful delivery clears notification next retry timestamp`） | 虽然用例在通知域，但重试机制由 Worker 通用能力承载。测试未复跑。 |
| 死信任务支持后台人工重放 | 已实现 | 中 | `backend/src/modules/worker/worker.routes.ts`（`POST /admin/jobs/:jobId/retry`）；`backend/src/modules/worker/worker.service.ts`（`retry`）；`backend/src/modules/worker/worker.repository.ts`（`retry` 将任务置为 `READY`） | 人工重放入口与状态回迁实现存在；当前未见独立自动化用例覆盖该后台接口。 |
| 安全定时任务启动时自动注册且不重复创建 | 已实现 | 强 | `backend/src/app.ts`（`buildApp` 调用 `worker.bootstrapRecurringSchedules`）；`backend/src/modules/worker/worker-schedule.ts`（仅注册安全周期任务：`order.timeout.scan`、`supplier.reconcile.inflight`、`supplier.reconcile.daily`）；`backend/tests/worker-scheduler-v1.test.ts`（`buildApp bootstraps one safe recurring job per supported task type`、`bootstrapping recurring schedules twice keeps jobs singleton`） | 定时任务自动注册与“无重复”均有直接测试源码；当前未复跑。 |

## 4. 关键缺口清单

### P1

- 未发现 P1。当前未见会直接阻断 V1 开放下单、履约、退款、通知、对账与任务调度主链路的硬缺口。

### P2

- 后台写操作审计覆盖未闭合。现有证据证明用户/角色创建、渠道创建、凭证创建已写审计，但渠道授权、定价、限额、回调配置等后台写操作未见同等审计证据，与“所有后台写操作都可追溯”验收项仍有差距。
- 商品动态同步失效的实现口径与 PRD 表述仍有差距。当前证据能证明动态数据超过 120 分钟后商品或映射会被过滤为不可售，但未见把商品或映射显式写回 `库存维护` 状态字段的实现证据；若正式验收坚持状态字段语义，需要先统一口径。
- 基础价差报表与对账闭环证据不足。当前已实现 `ORDER_PROFIT` 流水与后台查询接口，但未见独立报表聚合或对账输出证据，尚不足以对“可用于报表与对账”作强判定。
- 风控异常标签口径未闭合。当前实现能保证 `preCheck` 非 `PASS` 或抛异常时不会放行下单，但未见“系统异常标签”直接落库的实现证据，与异常口径仍有差距。

### P3

- 基础角色基线的交付形式偏弱。角色模型已支持 `OPS / FINANCE / RISK / SUPPORT`，但未见固定基线数据或自动校验用例；该问题不会推翻主链路验收，更适合作为补强项记录。

## 5. 文档问题清单

### 5.1 PRD 内部冲突

- `docs/渠道服务PRD.md` 已在 `3.1 当前 V1 渠道模型` 明确“当前代码实际交付为单层渠道主体”，但 `10. 验收标准` 第 1 条仍写“渠道可按层级创建并维护上下级关系”，同一文档内口径冲突。
- `docs/整体设计.md` 已在 `3.1 本期范围` 写明“当前 V1 实际交付为单层渠道主体”，但 `6. 核心对象模型` 仍写 `Channel | 渠道主体，支持层级关系`，总设计文档内部口径未收敛。
- `docs/整体设计.md` 自称“唯一总设计文档”，但 `1. 文档信息` 与文末附录仍把文档目录和引用路径写成 `new_docs/`，与当前仓库实际 `docs/` 路径不一致，影响验收引用链的可用性。

### 5.2 README 与 PRD 口径不一致

- `backend/src/modules/products/README.md` 仍以“分类、SPU、SKU、`skuId`”为核心模型，接口也保留 `GET /internal/products/skus/:skuId/*` 口径；而 `docs/商品服务PRD.md` 与 `docs/整体设计.md` 已将 V1 对外口径统一为 `product_id` 最小可售单元。
- `backend/src/modules/risk/README.md` 仍写“人工审核骨架”“`risk_review_cases`”“金额超阈值进入审核”，但 `docs/风控服务PRD.md` 已明确 V1 只输出 `PASS / REJECT`，且“不返回 `REVIEW`”“不做人工审核”。
- `backend/src/modules/ledger/README.md` 把 `/internal/settlement/accounts/freeze` 与 `/internal/settlement/accounts/unfreeze` 列为核心接口，而 `docs/结算与账务服务PRD.md` 已明确这两条接口仅为兼容占位，不代表 V1 已交付冻结/解冻能力。
- `backend/src/modules/iam/README.md` 仍写“权限、数据权限”与 `iam.permissions`，但 `docs/用户与权限服务PRD.md` 的 V1 范围只承诺基础角色管理与基础后台访问控制，不承诺完整细粒度 RBAC。

### 5.3 验收标准超出当前实现说明

- `docs/用户与权限服务PRD.md` 要求“所有后台写操作都可追溯到用户和时间”，而当前矩阵能确认的是“部分后台写操作已接入审计”，该标准强于现有实现证据。
- `docs/商品服务PRD.md` 要求“动态同步失效时商品会自动进入 `库存维护`”且“商品列表可供运营查看与导出”，而当前实现证据更接近“超过新鲜度阈值即不可售”和“提供列表查询”；“显式状态写回”“导出”均未形成同强度证据。
- `docs/订单服务PRD.md` 将 `slaSnapshot` 写为核心对象字段并纳入验收标准，而当前实现证据是通过 `warningDeadlineAt`、`expireDeadlineAt` 等字段等效固化 SLA，文档表述强于当前实现说明。
- `docs/供应商服务PRD.md` 的验收标准写明“支持至少 1 家真实供应商接入”“熔断、恢复、降权规则可验证”，而当前 V1 验收主路径以 `mock-supplier` 为主，矩阵也未把健康治理能力列为已闭环强证据，文档标准明显超前于当前交付说明。
- `docs/结算与账务服务PRD.md` 把“基础价差可用于报表与对账”写入验收标准，而当前实现证据主要是账务流水与查询接口，尚未形成独立报表口径说明。

### 5.4 建议优先修订的文档

- 第一优先级：`docs/整体设计.md`。该文档是总口径入口，应先修正 `new_docs/` 引用、单层渠道描述与核心对象表，避免所有验收引用继续扩散旧口径。
- 第二优先级：`docs/渠道服务PRD.md`、`docs/订单服务PRD.md`。前者需要删除层级渠道验收条目，后者需要统一 `parentChannelId`、`slaSnapshot` 等与当前 V1 交付不一致的字段口径。
- 第三优先级：`docs/商品服务PRD.md`、`docs/供应商服务PRD.md`、`docs/结算与账务服务PRD.md`、`docs/风控服务PRD.md`。这些文档应把“等效实现”“mock 验收路径”“异常标签/报表口径”写清楚，避免正式验收继续以更高口径追问。
- 第四优先级：`backend/src/modules/products/README.md`、`backend/src/modules/risk/README.md`、`backend/src/modules/ledger/README.md`、`backend/src/modules/iam/README.md`。这些 README 应回收到当前 V1 实际模型与接口，避免研发和测试继续参考旧实现叙述。

## 6. 建议结论

### 6.1 功能实现结论

当前软件功能已基本覆盖 V1 有效范围。`3.1` 至 `3.9` 中多数验收项可判定为“已实现”，少数“部分实现”主要集中在审计覆盖、显式状态写回、价差报表口径和风控异常标签等补强点；依据当前证据，未发现足以推翻主链路验收的实现硬缺口。

### 6.2 文档一致性结论

当前文档一致性不足，不能直接作为正式验收的唯一口径。总设计、PRD 与模块 README 间存在多处冲突，且部分验收标准明显强于当前实现说明；正式验收前至少需要统一单层渠道、`product_id` 口径、风控输出边界以及若干旧接口/旧模型描述，否则验收参与方会对同一实现得出不同判断。

### 6.3 最终建议

有条件通过。

理由如下：

- 现在还不宜写成“可验收通过”，因为除文档冲突外，`## 4` 已明确存在若干 P2 级实现或证据缺口，且本次现场无法复跑 `backend` 的 `bun test`，直接原因是缺少 `POSTGRES_*` 环境变量，证据完整性仍有不足。
- 现在也不到“暂不建议通过”，因为当前未发现 P1 级主链路阻断项，开放下单到履约、退款、通知、对账与 Worker 调度的主链路仍可由实现路径、数据库约束与测试源码形成基本闭环。
- 因此，本次建议为“有条件通过”，前提是正式验收前至少完成以下条件中的一项或组合：统一正式验收文档口径；对 P2 项补证、修复，或在正式验收中书面豁免并锁定当前实现口径；补齐可复跑环境或提供既有 CI / 集成测试结果，以弥补本次 `POSTGRES_*` 环境缺失导致的未复跑限制。
