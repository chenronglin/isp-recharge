import type { CreateWorkerJobInput, WorkerJobType } from '@/modules/worker/worker.types';

export interface RecurringWorkerSchedule {
  jobType: WorkerJobType;
  businessKey: string;
  payload: Record<string, unknown>;
  intervalSeconds: number;
}

export const recurringWorkerSchedules: RecurringWorkerSchedule[] = [
  {
    jobType: 'supplier.catalog.full-sync',
    businessKey: 'system:supplier-catalog-full-sync',
    payload: {},
    intervalSeconds: 24 * 60 * 60,
  },
  {
    jobType: 'supplier.catalog.delta-sync',
    businessKey: 'system:supplier-catalog-delta-sync',
    payload: {},
    intervalSeconds: 60 * 60,
  },
  {
    jobType: 'order.timeout.scan',
    businessKey: 'system:order-timeout-scan',
    payload: {},
    intervalSeconds: 60,
  },
  {
    jobType: 'supplier.reconcile.inflight',
    businessKey: 'system:supplier-reconcile-inflight',
    payload: {},
    intervalSeconds: 10 * 60,
  },
  {
    jobType: 'supplier.reconcile.daily',
    businessKey: 'system:supplier-reconcile-daily',
    payload: {},
    intervalSeconds: 24 * 60 * 60,
  },
];

const recurringWorkerScheduleMap = new Map(
  recurringWorkerSchedules.map((schedule) => [`${schedule.jobType}:${schedule.businessKey}`, schedule]),
);

export function toScheduledJobInput(schedule: RecurringWorkerSchedule): CreateWorkerJobInput {
  return {
    jobType: schedule.jobType,
    businessKey: schedule.businessKey,
    payload: schedule.payload,
    nextRunAt: getNextRecurringRunAt(schedule, new Date()),
  };
}

export function getRecurringWorkerSchedule(jobType: string, businessKey: string) {
  return recurringWorkerScheduleMap.get(`${jobType}:${businessKey}`) ?? null;
}

export function getNextRecurringRunAt(schedule: RecurringWorkerSchedule, now = new Date()): Date {
  return new Date(now.getTime() + schedule.intervalSeconds * 1000);
}
