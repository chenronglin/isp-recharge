# 《Worker 任务系统详细 PRD》

## 1. 文档定位

Worker 任务系统负责异步调度、重试、补偿与执行审计，为供应商同步、供应商履约、超时扫描、通知重试、退款补偿与对账任务提供统一运行底座。

## 2. 职责边界

### 2.1 负责内容

- 任务入队。
- 延迟执行。
- 周期调度。
- 自动重试。
- 死信转移。
- 手工重试。
- 执行日志。

### 2.2 不负责内容

- 业务规则决策。
- 订单终态判定。
- 供应商协议解析。

## 3. 任务类型

### 3.1 供应商相关

- `supplier.catalog.full-sync`
- `supplier.catalog.delta-sync`
- `supplier.submit`
- `supplier.query`
- `supplier.reconcile.inflight`
- `supplier.reconcile.daily`

### 3.2 订单相关

- `order.timeout.scan`
- `refund.retry`

### 3.3 通知相关

- `notification.deliver`

## 4. 核心状态

- `NEW`
- `READY`
- `RUNNING`
- `SUCCESS`
- `FAIL`
- `RETRY_WAIT`
- `DEAD_LETTER`
- `CANCELED`

## 5. 核心规则

1. 使用 `jobType + businessKey` 做去重。
2. 失败必须按退避策略重试。
3. 超过最大重试次数转入死信。
4. 周期任务必须持续重复执行，而不是仅启动时投递一次。
5. 任务执行与业务结果必须解耦，Worker 只负责调度。

## 6. 调度建议

### 6.1 定时任务

- 每天 1 次供应商全量商品同步
- 每 60 分钟 1 次供应商动态同步
- 每分钟 1 次订单超时扫描
- 每 10 分钟 1 次未终态订单差异扫描
- 每天 1 次日对账

### 6.2 延迟任务

- 供应商查单任务按产品类型时间点延迟投递
- 通知重试按退避时间延迟投递
- 退款失败重试按退避时间延迟投递

## 7. 接口设计

### 7.1 后台 API

- `GET /admin/jobs`
- `GET /admin/jobs/:jobId`
- `POST /admin/jobs/:jobId/retry`
- `POST /admin/jobs/:jobId/cancel`
- `GET /admin/jobs/dead-letters`

### 7.2 内部 API

- `POST /internal/jobs/enqueue`
- `POST /internal/jobs/schedule`

## 8. 数据设计建议

- `worker.worker_jobs`
- `worker.worker_job_attempts`
- `worker.worker_dead_letters`

## 9. 异常处理

- 重复入队：返回已有活跃任务。
- 执行器异常：记录失败并重试。
- 长期失败：进入死信并报警。

## 10. 验收标准

1. 任务可按类型正常调度。
2. 重复任务不会产生多个活跃执行。
3. 失败任务会自动重试。
4. 周期任务会持续重复执行。
5. 死信任务支持后台人工重放。

## 11. 明确不做

- 多集群复杂调度编排。
- 可视化 DAG。
- 跨地域任务编排。
