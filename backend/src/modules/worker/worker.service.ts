import { notFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { WorkerContract } from '@/modules/worker/contracts';
import type { WorkerRepository } from '@/modules/worker/worker.repository';
import { recurringWorkerSchedules, toScheduledJobInput } from '@/modules/worker/worker-schedule';
import type {
  CreateWorkerJobInput,
  WorkerJobHandler,
  WorkerJobType,
} from '@/modules/worker/worker.types';

const retryBackoffInSeconds = [1, 5, 10, 30, 60];

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function isRetryableError(error: unknown): error is Error & { retryable: true; nextRetryAt: Date } {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Partial<{ retryable: boolean; nextRetryAt: unknown }>;

  return candidate.retryable === true && candidate.nextRetryAt instanceof Date;
}

export class WorkerService implements WorkerContract {
  private readonly handlers = new Map<WorkerJobType, WorkerJobHandler>();
  private timer: Timer | null = null;

  constructor(private readonly repository: WorkerRepository) {}

  registerHandler(jobType: WorkerJobType, handler: WorkerJobHandler): void {
    this.handlers.set(jobType, handler);
  }

  listRegisteredJobTypes(): WorkerJobType[] {
    return Array.from(this.handlers.keys());
  }

  async enqueue(input: CreateWorkerJobInput) {
    const existing = await this.repository.findByJobTypeAndBusinessKey(
      input.jobType,
      input.businessKey,
    );

    if (existing && ['READY', 'RUNNING', 'RETRY_WAIT'].includes(existing.status)) {
      return existing;
    }

    if (existing) {
      return this.repository.reactivate({
        jobId: existing.id,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? existing.maxAttempts,
        nextRunAt: new Date(),
      });
    }

    return this.repository.create({
      ...input,
      nextRunAt: new Date(),
    });
  }

  async schedule(input: CreateWorkerJobInput) {
    const existing = await this.repository.findByJobTypeAndBusinessKey(
      input.jobType,
      input.businessKey,
    );

    if (existing && ['READY', 'RETRY_WAIT'].includes(existing.status)) {
      return this.repository.rescheduleActive({
        jobId: existing.id,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? existing.maxAttempts,
        nextRunAt: input.nextRunAt ?? new Date(),
      });
    }

    if (existing?.status === 'RUNNING') {
      return existing;
    }

    if (existing) {
      return this.repository.reactivate({
        jobId: existing.id,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? existing.maxAttempts,
        nextRunAt: input.nextRunAt ?? new Date(),
      });
    }

    return this.repository.create(input);
  }

  async processReadyJobs(limit = 20): Promise<void> {
    const jobs = await this.repository.claimReady(limit);

    for (const job of jobs) {
      const handler = this.handlers.get(job.jobType as WorkerJobType);

      if (!handler) {
        await this.repository.markDeadLetter(job.id, `未找到任务处理器: ${job.jobType}`);
        continue;
      }
      const startedAt = Date.now();

      try {
        // 任务处理的具体业务逻辑由注册的 handler 决定，
        // Worker 这里只负责调度和重试，不承载业务规则定义。
        await handler(job.payloadJson);
        const duration = Date.now() - startedAt;

        await this.repository.addAttempt(job.id, job.attemptCount + 1, 'SUCCESS', null, duration);
        await this.repository.markSuccess(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知任务执行错误';
        const duration = Date.now() - startedAt;
        const nextAttemptNo = job.attemptCount + 1;

        await this.repository.addAttempt(job.id, nextAttemptNo, 'FAIL', message, duration);

        if (nextAttemptNo >= job.maxAttempts) {
          await this.repository.markDeadLetter(job.id, message);
          continue;
        }

        const nextRunAt = isRetryableError(error)
          ? error.nextRetryAt
          : addSeconds(
              new Date(),
              retryBackoffInSeconds[Math.min(nextAttemptNo - 1, retryBackoffInSeconds.length - 1)],
            );

        await this.repository.markRetry(job.id, nextRunAt, message);
      }
    }
  }

  async retry(jobId: string): Promise<void> {
    const job = await this.repository.getById(jobId);

    if (!job) {
      throw notFound('任务不存在');
    }

    await this.repository.retry(jobId);
  }

  async cancel(jobId: string): Promise<void> {
    const job = await this.repository.getById(jobId);

    if (!job) {
      throw notFound('任务不存在');
    }

    await this.repository.cancel(jobId);
  }

  async listDeadLetters() {
    return this.repository.listDeadLetters();
  }

  async list(page: number, pageSize: number) {
    return this.repository.list(page, pageSize);
  }

  async getById(jobId: string) {
    const job = await this.repository.getById(jobId);

    if (!job) {
      throw notFound('任务不存在');
    }

    return job;
  }

  async bootstrapRecurringSchedules(): Promise<void> {
    for (const schedule of recurringWorkerSchedules) {
      await this.schedule(toScheduledJobInput(schedule));
    }
  }

  startScheduler(intervalMs = 1000): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(async () => {
      try {
        await this.processReadyJobs();
      } catch (error) {
        logger.error('Worker 定时调度失败', error);
      }
    }, intervalMs);
  }

  stopScheduler(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }
}
