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
  getById(jobId: string): Promise<unknown>;
  listJobItems(jobId: string): Promise<unknown[]>;
  listJobArtifacts(jobId: string): Promise<unknown[]>;
  upsertJobItem(input: {
    jobId: string;
    itemNo: string;
    status: string;
    payloadJson?: Record<string, unknown>;
    resultJson?: Record<string, unknown>;
    errorMessage?: string | null;
  }): Promise<void>;
  createArtifact(input: {
    jobId: string;
    artifactType: string;
    fileName: string;
    filePath: string;
    downloadUrl: string;
  }): Promise<void>;
  completeJob(jobId: string): Promise<void>;
  retry(jobId: string): Promise<void>;
  cancel(jobId: string): Promise<void>;
  listDeadLetters(): Promise<WorkerDeadLetter[]>;
}
