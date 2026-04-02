import type {
  CreateWorkerJobInput,
  WorkerDeadLetter,
  WorkerJob,
  WorkerJobHandler,
  WorkerJobType,
} from '@/modules/worker/worker.types';

export interface WorkerContract {
  enqueue(input: CreateWorkerJobInput): Promise<WorkerJob>;
  schedule(input: CreateWorkerJobInput): Promise<WorkerJob>;
  processReadyJobs(limit?: number): Promise<void>;
  registerHandler(jobType: WorkerJobType, handler: WorkerJobHandler): void;
  listRegisteredJobTypes(): WorkerJobType[];
  retry(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  listDeadLetters(): Promise<WorkerDeadLetter[]>;
}
