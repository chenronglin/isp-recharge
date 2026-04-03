export const workerJobTypes = [
  'supplier.catalog.full-sync',
  'supplier.catalog.delta-sync',
  'supplier.submit',
  'supplier.query',
  'supplier.reconcile.inflight',
  'supplier.reconcile.daily',
  'order.timeout.scan',
  'order.refund.retry',
  'notification.deliver',
] as const;

export type WorkerJobType = (typeof workerJobTypes)[number];

export type WorkerJobStatus =
  | 'NEW'
  | 'READY'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAIL'
  | 'RETRY_WAIT'
  | 'DEAD_LETTER'
  | 'CANCELED';

export interface WorkerJob {
  id: string;
  jobType: WorkerJobType | string;
  businessKey: string;
  payloadJson: Record<string, unknown>;
  status: WorkerJobStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerJobAttempt {
  id: string;
  jobId: string;
  attemptNo: number;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}

export interface WorkerDeadLetter {
  id: string;
  jobId: string;
  businessKey: string;
  payloadJson: Record<string, unknown>;
  reason: string;
  createdAt: string;
}

export interface CreateWorkerJobInput {
  jobType: WorkerJobType | string;
  businessKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  nextRunAt?: Date;
}

export type WorkerJobHandler = (payload: Record<string, unknown>) => Promise<void>;
