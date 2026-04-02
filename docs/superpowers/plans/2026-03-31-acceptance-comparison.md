# 代码与文档验收比对执行计划 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出一份基于“混合证据法”的完整验收比对报告，判断当前 ISP 话费充值平台 V1 是否已实现文档定义的有效范围，并分离实现缺口与文档问题。

**Architecture:** 先建立一份统一的验收报告骨架，再按模块分批抽取有效验收项、回填代码与测试证据、标注判定结果，最后汇总关键缺口、文档冲突和总体验收结论。虽然验收对象覆盖多个模块，但本次交付物只有一份报告，因此保持单一计划更利于统一口径和最终总评。

**Tech Stack:** Markdown、TypeScript、Bun、Elysia、SQL 迁移脚本、ripgrep、git

---

## 文件结构

### 产出文件

- Create: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`

### 核心参考文件

- Spec: `docs/superpowers/specs/2026-03-31-acceptance-comparison-design.md`
- Docs: `docs/整体设计.md`
- Docs: `docs/用户与权限服务PRD.md`
- Docs: `docs/渠道服务PRD.md`
- Docs: `docs/商品服务PRD.md`
- Docs: `docs/订单服务PRD.md`
- Docs: `docs/供应商服务PRD.md`
- Docs: `docs/结算与账务服务PRD.md`
- Docs: `docs/风控服务PRD.md`
- Docs: `docs/通知服务PRD.md`
- Docs: `docs/Worker任务系统PRD.md`
- Code: `backend/src/`
- Tests: `backend/tests/`

### 工作约束

- 所有“已实现 / 部分实现 / 未实现 / 文档过期或冲突”结论都必须能追溯到明确证据。
- 如果某条验收项只能找到代码痕迹、找不到测试或数据库模型支撑，允许判为“部分实现”或“已实现（证据弱）”，不要直接拔高。
- 若 README 与 PRD 冲突，以 `docs/*.md` 的“当前实现说明”为主，README 冲突统一归入文档问题清单。

### Task 1: 建立验收报告骨架

**Files:**
- Create: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Reference: `docs/superpowers/specs/2026-03-31-acceptance-comparison-design.md`

- [ ] **Step 1: 创建报告目录**

Run:

```bash
mkdir -p docs/superpowers/reports
```

Expected: 无输出，目录 `docs/superpowers/reports` 已存在。

- [ ] **Step 2: 写入报告骨架**

将以下内容写入 `docs/superpowers/reports/2026-03-31-acceptance-report.md`：

```markdown
# ISP 话费充值平台 V1 验收比对报告

## 1. 总体结论

## 2. 判定口径

## 3. 模块验收矩阵

### 3.1 用户与权限

### 3.2 渠道

### 3.3 商品

### 3.4 订单

### 3.5 供应商

### 3.6 结算与账务

### 3.7 风控

### 3.8 通知

### 3.9 Worker 任务系统

## 4. 关键缺口清单

## 5. 文档问题清单

## 6. 建议结论
```

- [ ] **Step 3: 验证报告结构已经写入**

Run:

```bash
rg -n "^#|^##|^###" docs/superpowers/reports/2026-03-31-acceptance-report.md
```

Expected: 能看到 `总体结论`、`模块验收矩阵`、`关键缺口清单`、`文档问题清单`、`建议结论` 等标题。

- [ ] **Step 4: 提交骨架**

```bash
git add docs/superpowers/reports/2026-03-31-acceptance-report.md
git commit -m "docs: scaffold acceptance comparison report"
```

### Task 2: 回填用户与权限、渠道、商品模块证据

**Files:**
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Reference: `docs/用户与权限服务PRD.md`
- Reference: `docs/渠道服务PRD.md`
- Reference: `docs/商品服务PRD.md`
- Reference: `backend/src/modules/iam/`
- Reference: `backend/src/modules/channels/`
- Reference: `backend/src/modules/products/`
- Test: `backend/tests/iam-login.test.ts`
- Test: `backend/tests/channels-limits-v1.test.ts`
- Test: `backend/tests/mobile-matching.test.ts`
- Test: `backend/tests/products-listing.test.ts`
- Test: `backend/tests/security.test.ts`

- [ ] **Step 1: 提取三个模块的有效验收项**

Run:

```bash
rg -n "当前实现说明|验收标准|接口设计|核心规则" \
  docs/用户与权限服务PRD.md \
  docs/渠道服务PRD.md \
  docs/商品服务PRD.md
```

Expected: 输出包含“当前实现说明”和“验收标准”的行号，能直接定位当前 V1 的有效口径。

- [ ] **Step 2: 抽取三个模块的核心实现入口**

Run:

```bash
rg -n "POST /admin/auth/login|POST /admin/auth/refresh|GET /admin/channels|POST /admin/channel-prices|GET /open-api/products|GET /internal/products" \
  backend/src/modules/iam \
  backend/src/modules/channels \
  backend/src/modules/products
```

Expected: 至少命中 `iam.routes.ts`、`channels.routes.ts`、`products.routes.ts` 中的对应接口定义。

- [ ] **Step 3: 运行三个模块的关键测试**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun test \
  tests/iam-login.test.ts \
  tests/channels-limits-v1.test.ts \
  tests/mobile-matching.test.ts \
  tests/products-listing.test.ts \
  tests/security.test.ts
```

Expected: 所有测试 PASS；输出中应覆盖登录会话、Nonce 重放、限额/QPS、商品匹配、签名安全等场景。

- [ ] **Step 4: 将三个模块的验收矩阵写入报告**

在 `docs/superpowers/reports/2026-03-31-acceptance-report.md` 中，为 `3.1 用户与权限`、`3.2 渠道`、`3.3 商品` 写入统一表格，表头固定为：

```markdown
| 验收项 | 判定结果 | 证据强度 | 关键证据位置 | 备注 |
|---|---|---|---|---|
```

每个模块至少覆盖以下验收项：

```markdown
### 3.1 用户与权限
- 后台管理员可登录并刷新会话
- 基础角色可区分运营、财务、风控、支持
- 被停用账号无法继续访问后台接口
- 后台写操作的审计追溯能力

### 3.2 渠道
- 开放 API 签名成功与失败场景可验证
- 商品授权、定价、限额在下单前生效
- 渠道未配置回调地址时不能下单
- 单层渠道模型与文档一致性

### 3.3 商品
- 可按省份、运营商、面额、充值类型完成商品匹配
- 商品状态与动态同步状态可阻断下单
- 动态同步失效时进入库存维护或等效不可售状态
- 商品列表可供后台与开放接口查询
```

- [ ] **Step 5: 验证报告中已经出现三个模块的判定表**

Run:

```bash
rg -n "### 3.1 用户与权限|### 3.2 渠道|### 3.3 商品|\\| 验收项 \\| 判定结果 \\|" \
  docs/superpowers/reports/2026-03-31-acceptance-report.md
```

Expected: 三个模块标题和对应表头都能被检索到。

- [ ] **Step 6: 提交基础模块结果**

```bash
git add docs/superpowers/reports/2026-03-31-acceptance-report.md
git commit -m "docs: assess iam channel and product modules"
```

### Task 3: 回填订单、供应商、结算与账务模块证据

**Files:**
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Reference: `docs/订单服务PRD.md`
- Reference: `docs/供应商服务PRD.md`
- Reference: `docs/结算与账务服务PRD.md`
- Reference: `backend/src/modules/orders/`
- Reference: `backend/src/modules/suppliers/`
- Reference: `backend/src/modules/ledger/`
- Test: `backend/tests/order-flow-v1.test.ts`
- Test: `backend/tests/order-timeout-v1.test.ts`
- Test: `backend/tests/orders.routes.test.ts`
- Test: `backend/tests/orders.service.test.ts`
- Test: `backend/tests/supplier-sync-v1.test.ts`
- Test: `backend/tests/supplier-reconcile-v1.test.ts`

- [ ] **Step 1: 提取三个模块的有效验收项**

Run:

```bash
rg -n "当前实现说明|验收标准|接口设计|核心规则" \
  docs/订单服务PRD.md \
  docs/供应商服务PRD.md \
  docs/结算与账务服务PRD.md
```

Expected: 能定位订单主链路、供应商同步/履约/对账、账务扣款/退款/价差等有效验收条目。

- [ ] **Step 2: 抽取交易主链路的实现入口**

Run:

```bash
rg -n "open-api/orders|internal/orders|callbacks/suppliers|confirmOrderProfit|refundOrderAmount|submitOrder|queryOrder" \
  backend/src/modules/orders \
  backend/src/modules/suppliers \
  backend/src/modules/ledger \
  backend/src/app.ts
```

Expected: 至少命中下单接口、内部事件入口、供应商回调入口、账务扣款/退款调用点。

- [ ] **Step 3: 运行交易主链路关键测试**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun test \
  tests/order-flow-v1.test.ts \
  tests/order-timeout-v1.test.ts \
  tests/orders.routes.test.ts \
  tests/orders.service.test.ts \
  tests/supplier-sync-v1.test.ts \
  tests/supplier-reconcile-v1.test.ts
```

Expected: 所有测试 PASS；输出覆盖下单幂等、超时扫描、自动退款、供应商同步、在途对账、日对账等场景。

- [ ] **Step 4: 将三个模块的验收矩阵写入报告**

在 `docs/superpowers/reports/2026-03-31-acceptance-report.md` 中，为 `3.4 订单`、`3.5 供应商`、`3.6 结算与账务` 写入统一表格，表头保持一致，并至少覆盖以下验收项：

```markdown
### 3.4 订单
- 基于 channelId + channelOrderNo 幂等
- 下单时固化识别结果、商品快照、渠道快照、供应商快照、SLA 快照
- FAST / MIXED 两类订单的超时规则分别生效
- 失败会自动触发退款
- 晚到回调不会逆转终态

### 3.5 供应商
- 商品全量/动态同步已落地
- 提单、查单、回调解析已落地
- 在途对账与日对账已落地
- 模拟供应商路径可支撑 V1 验收

### 3.6 结算与账务
- 可按渠道校验余额并扣款
- 失败订单可自动退款并冲正
- 同一订单不会重复退款
- 基础价差可用于报表与对账
```

- [ ] **Step 5: 对账务证据强度做单独复核**

Run:

```bash
rg -n "ensureBalanceSufficient|debitOrderAmount|refundOrderAmount|confirmOrderProfit" \
  backend/src/modules/ledger \
  backend/src/modules/orders \
  backend/tests
```

Expected: 能同时看到账务 contract/service 调用点和至少一组被订单流测试覆盖的证据。

- [ ] **Step 6: 提交交易链路结果**

```bash
git add docs/superpowers/reports/2026-03-31-acceptance-report.md
git commit -m "docs: assess order supplier and ledger modules"
```

### Task 4: 回填风控、通知、Worker 与公共协议证据

**Files:**
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Reference: `docs/风控服务PRD.md`
- Reference: `docs/通知服务PRD.md`
- Reference: `docs/Worker任务系统PRD.md`
- Reference: `backend/src/modules/risk/`
- Reference: `backend/src/modules/notifications/`
- Reference: `backend/src/modules/worker/`
- Reference: `backend/src/app.ts`
- Test: `backend/tests/risk-v1.test.ts`
- Test: `backend/tests/notifications-retry-v1.test.ts`
- Test: `backend/tests/worker-claiming.test.ts`
- Test: `backend/tests/worker-scheduler-v1.test.ts`
- Test: `backend/tests/openapi.test.ts`
- Test: `backend/tests/schema-v1.test.ts`
- Test: `backend/tests/cors.test.ts`

- [ ] **Step 1: 提取三个模块的有效验收项**

Run:

```bash
rg -n "当前实现说明|验收标准|接口设计|核心规则" \
  docs/风控服务PRD.md \
  docs/通知服务PRD.md \
  docs/Worker任务系统PRD.md
```

Expected: 能定位黑白名单/同步预检、Webhook 重试/死信、Worker 去重/重试/死信/人工重放等条目。

- [ ] **Step 2: 抽取事件总线与任务调度入口**

Run:

```bash
rg -n "NotificationRequested|NotificationSucceeded|NotificationFailed|supplier.reconcile.daily|order.timeout.scan|notification.deliver|pre-check" \
  backend/src/app.ts \
  backend/src/modules/risk \
  backend/src/modules/notifications \
  backend/src/modules/worker
```

Expected: 能看到风控预检入口、通知事件订阅、Worker 注册任务处理器和定时调度的代码位置。

- [ ] **Step 3: 运行风控、通知、Worker 与公共协议测试**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun test \
  tests/risk-v1.test.ts \
  tests/notifications-retry-v1.test.ts \
  tests/worker-claiming.test.ts \
  tests/worker-scheduler-v1.test.ts \
  tests/openapi.test.ts \
  tests/schema-v1.test.ts \
  tests/cors.test.ts
```

Expected: 所有测试 PASS；输出覆盖风控拦截、Webhook 自动重试与死信、任务去重与单例调度、OpenAPI/Schema/CORS 基础协议。

- [ ] **Step 4: 将三个模块的验收矩阵写入报告**

在 `docs/superpowers/reports/2026-03-31-acceptance-report.md` 中，为 `3.7 风控`、`3.8 通知`、`3.9 Worker 任务系统` 写入统一表格，并至少覆盖以下验收项：

```markdown
### 3.7 风控
- 黑名单命中可直接拒单
- 白名单可优先放行
- 风险决策可查询、可追溯
- 风控异常时不放开高风险请求

### 3.8 通知
- 成功订单可触发成功通知
- 退款订单可触发退款通知
- Webhook 失败后会自动重试
- 超过重试次数的任务会进入死信

### 3.9 Worker 任务系统
- 任务按 jobType + businessKey 去重
- 失败任务会自动重试
- 死信任务支持后台人工重放
- 安全定时任务启动时自动注册且不重复创建
```

- [ ] **Step 5: 为公共协议与基础设施补一段交叉说明**

在报告的 `2. 判定口径` 或各模块备注中补充一句说明：`OpenAPI 文档、统一响应结构、CORS 与 schema 测试属于跨模块基础能力，只作为证据增强项，不单独替代业务验收。`

- [ ] **Step 6: 提交保障模块结果**

```bash
git add docs/superpowers/reports/2026-03-31-acceptance-report.md
git commit -m "docs: assess risk notification and worker modules"
```

### Task 5: 汇总文档问题、关键缺口与总评

**Files:**
- Modify: `docs/superpowers/reports/2026-03-31-acceptance-report.md`
- Reference: `docs/*.md`
- Reference: `backend/src/modules/*/README.md`

- [ ] **Step 1: 检索文档中可能过期或冲突的口径**

Run:

```bash
rg -n "单层渠道|层级|sku|SPU|冻结|解冻|REVIEW|人工审核|notification_templates|permissions|product_skus|多级分润" \
  docs/*.md \
  backend/src/modules/*/README.md
```

Expected: 输出一组潜在冲突点，例如渠道层级、商品模型、冻结/解冻占位接口、README 中旧表名和旧对象模型等。

- [ ] **Step 2: 写入文档问题清单**

在报告的 `5. 文档问题清单` 中，至少按以下小类整理：

```markdown
### 5.1 PRD 内部冲突

### 5.2 README 与 PRD 口径不一致

### 5.3 验收标准超出当前实现说明

### 5.4 建议优先修订的文档
```

- [ ] **Step 3: 写入关键缺口与总评**

在报告的 `4. 关键缺口清单` 和 `6. 建议结论` 中，使用以下固定小节：

```markdown
## 4. 关键缺口清单

### P1

### P2

### P3

## 6. 建议结论

### 6.1 功能实现结论

### 6.2 文档一致性结论

### 6.3 最终建议
```

最终建议只能使用以下三个结论之一：`可验收通过`、`有条件通过`、`暂不建议通过`。

- [ ] **Step 4: 运行全量测试，确认报告引用的测试证据仍然成立**

工作目录：`/Users/moses/Trae-CN/isp-recharge/backend`

Run:

```bash
bun test
```

Expected: 全量测试 PASS；如果存在失败，先修正报告中的判定和证据引用，不要带着失效证据结束任务。

- [ ] **Step 5: 扫描报告中的占位词和模糊标签**

Run:

```bash
rg -n "TBD|TODO|待补|待定|后续补充|大概|可能|似乎" \
  docs/superpowers/reports/2026-03-31-acceptance-report.md
```

Expected: 无输出。

- [ ] **Step 6: 提交最终报告**

```bash
git add docs/superpowers/reports/2026-03-31-acceptance-report.md
git commit -m "docs: complete acceptance comparison report"
```

## 自检清单

### Spec 覆盖

- Spec 中要求的范围、证据方法、判定标签、风险分级、总评规则，都在任务 1 到任务 5 中有落点。
- Spec 中的 9 个模块拆分在任务 2、任务 3、任务 4 中全部覆盖。
- Spec 中要求分离“功能实现结论”和“文档一致性结论”，已经在任务 5 的最终结论结构中固定。

### 占位检查

- 计划内没有使用 `TBD`、`TODO`、`实现细节待补` 之类的占位语。
- 所有 shell 命令都给出了明确路径、工作目录或文件列表。
- 所有提交信息都已经具体到模块范围，没有“update stuff”这类模糊描述。

### 类型与命名一致性

- 设计文档中的四类判定结果固定为：`已实现`、`部分实现`、`未实现`、`文档过期/冲突`。
- 风险分级固定为：`P1`、`P2`、`P3`。
- 最终建议固定为：`可验收通过`、`有条件通过`、`暂不建议通过`。
