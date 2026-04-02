import type { CreateWorkerJobInput, WorkerJobType } from '@/modules/worker/worker.types';

interface RecurringWorkerSchedule {
  jobType: WorkerJobType;
  businessKey: string;
  payload: Record<string, unknown>;
}

// 当前只自动启动可安全执行的周期任务。
// supplier catalog sync 仍依赖真实上游拉取入口，因此暂不做自动调度。
export const recurringWorkerSchedules: RecurringWorkerSchedule[] = [
  {
    jobType: 'order.timeout.scan',
    businessKey: 'system:order-timeout-scan',
    payload: {},
  },
  {
    jobType: 'supplier.reconcile.inflight',
    businessKey: 'system:supplier-reconcile-inflight',
    payload: {},
  },
  {
    jobType: 'supplier.reconcile.daily',
    businessKey: 'system:supplier-reconcile-daily',
    payload: {},
  },
];

export function toScheduledJobInput(schedule: RecurringWorkerSchedule): CreateWorkerJobInput {
  return {
    jobType: schedule.jobType,
    businessKey: schedule.businessKey,
    payload: schedule.payload,
    nextRunAt: new Date(),
  };
}
