# Worker 任务系统模块详细设计

## 模块职责

- 统一承接异步任务入队、延迟调度、重试、死信与执行审计。
- 为订单、供应商、通知、结算等模块提供统一异步执行能力。

## 核心表

- `worker.worker_jobs`
- `worker.worker_job_attempts`
- `worker.worker_dead_letters`

## 核心状态

- `NEW`
- `READY`
- `RUNNING`
- `SUCCESS`
- `FAIL`
- `RETRY_WAIT`
- `DEAD_LETTER`
- `CANCELED`

## 暴露接口

- 后台：
  - `GET /admin/jobs`
  - `GET /admin/jobs/:jobId`
  - `POST /admin/jobs/:jobId/retry`
  - `POST /admin/jobs/:jobId/cancel`
  - `GET /admin/jobs/dead-letters`
- 内部：
  - `POST /internal/jobs/enqueue`
  - `POST /internal/jobs/schedule`

## 业务规则

- 任务用 `jobType + businessKey` 去重。
- 执行失败按退避策略自动重试。
- 超过阈值转入死信，支持后台人工重放。

## 测试重点

- 重复入队不会产生多个活跃任务。
- 执行失败会进入重试。
- 超出最大重试次数进入死信。
- 人工重试可以让死信任务重新执行。
