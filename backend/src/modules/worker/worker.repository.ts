import { generateId } from '@/lib/id';
import { db, first, many } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { workerSql } from '@/modules/worker/worker.sql';
import type {
  CreateWorkerJobInput,
  WorkerDeadLetter,
  WorkerJob,
} from '@/modules/worker/worker.types';

export class WorkerRepository {
  private mapJob(row: WorkerJob): WorkerJob {
    return {
      ...row,
      payloadJson: parseJsonValue(row.payloadJson, {}),
    };
  }

  async findByJobTypeAndBusinessKey(
    jobType: string,
    businessKey: string,
  ): Promise<WorkerJob | null> {
    const row = await first<WorkerJob>(db<WorkerJob[]>`
      SELECT
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM worker.worker_jobs
      WHERE job_type = ${jobType}
        AND business_key = ${businessKey}
      LIMIT 1
    `);

    return row ? this.mapJob(row) : null;
  }

  async create(input: CreateWorkerJobInput): Promise<WorkerJob> {
    const rows = await db<WorkerJob[]>`
      INSERT INTO worker.worker_jobs (
        id,
        job_type,
        business_key,
        payload_json,
        status,
        attempt_count,
        max_attempts,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.jobType},
        ${input.businessKey},
        ${JSON.stringify(input.payload)},
        'READY',
        0,
        ${input.maxAttempts ?? 5},
        ${input.nextRunAt ?? new Date()},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const createdJob = rows[0];

    if (!createdJob) {
      throw new Error('创建任务失败');
    }

    return this.mapJob(createdJob);
  }

  async reactivate(input: {
    jobId: string;
    payload: Record<string, unknown>;
    maxAttempts: number;
    nextRunAt: Date;
  }): Promise<WorkerJob> {
    const rows = await db<WorkerJob[]>`
      UPDATE worker.worker_jobs
      SET
        payload_json = ${JSON.stringify(input.payload)},
        status = 'READY',
        attempt_count = 0,
        max_attempts = ${input.maxAttempts},
        next_run_at = ${input.nextRunAt},
        last_error = NULL,
        updated_at = NOW()
      WHERE id = ${input.jobId}
      RETURNING
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const reactivatedJob = rows[0];

    if (!reactivatedJob) {
      throw new Error('重置任务失败');
    }

    return this.mapJob(reactivatedJob);
  }

  async list(page: number, pageSize: number): Promise<{ items: WorkerJob[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const items = await db.unsafe<WorkerJob[]>(workerSql.listJobs, [pageSize, offset]);
    const totalRow = await first<{ total: number }>(db.unsafe(workerSql.countJobs));

    return {
      items: items.map((row) => this.mapJob(row)),
      total: totalRow?.total ?? 0,
    };
  }

  async listByJobType(jobType: string, limit = 20): Promise<WorkerJob[]> {
    const rows = await many<WorkerJob>(db<WorkerJob[]>`
      SELECT
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM worker.worker_jobs
      WHERE job_type = ${jobType}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => this.mapJob(row));
  }

  async getById(jobId: string): Promise<WorkerJob | null> {
    const row = await first<WorkerJob>(db<WorkerJob[]>`
      SELECT
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM worker.worker_jobs
      WHERE id = ${jobId}
      LIMIT 1
    `);

    return row ? this.mapJob(row) : null;
  }

  async claimReady(limit: number): Promise<WorkerJob[]> {
    const rows = await db.begin(
      (tx) =>
        tx<WorkerJob[]>`
        WITH claimable AS (
          SELECT id
          FROM worker.worker_jobs
          WHERE status IN ('READY', 'RETRY_WAIT')
            AND next_run_at <= NOW()
          ORDER BY next_run_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE worker.worker_jobs AS job
        SET
          status = 'RUNNING',
          updated_at = NOW()
        FROM claimable
        WHERE job.id = claimable.id
        RETURNING
          job.id,
          job.job_type AS "jobType",
          job.business_key AS "businessKey",
          job.payload_json AS "payloadJson",
          job.status,
          job.attempt_count AS "attemptCount",
          job.max_attempts AS "maxAttempts",
          job.next_run_at AS "nextRunAt",
          job.last_error AS "lastError",
          job.created_at AS "createdAt",
          job.updated_at AS "updatedAt"
      `,
    );

    return rows.map((row) => this.mapJob(row));
  }

  async markSuccess(jobId: string): Promise<void> {
    await db`
      UPDATE worker.worker_jobs
      SET
        status = 'SUCCESS',
        last_error = NULL,
        updated_at = NOW()
      WHERE id = ${jobId}
    `;
  }

  async rescheduleActive(input: {
    jobId: string;
    payload: Record<string, unknown>;
    maxAttempts: number;
    nextRunAt: Date;
  }): Promise<WorkerJob> {
    const rows = await db<WorkerJob[]>`
      UPDATE worker.worker_jobs
      SET
        payload_json = ${JSON.stringify(input.payload)},
        max_attempts = ${input.maxAttempts},
        next_run_at = ${input.nextRunAt},
        updated_at = NOW()
      WHERE id = ${input.jobId}
      RETURNING
        id,
        job_type AS "jobType",
        business_key AS "businessKey",
        payload_json AS "payloadJson",
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        next_run_at AS "nextRunAt",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const scheduledJob = rows[0];

    if (!scheduledJob) {
      throw new Error('重设任务调度失败');
    }

    return this.mapJob(scheduledJob);
  }

  async markRetry(jobId: string, nextRunAt: Date, errorMessage: string): Promise<void> {
    await db`
      UPDATE worker.worker_jobs
      SET
        status = 'RETRY_WAIT',
        attempt_count = attempt_count + 1,
        next_run_at = ${nextRunAt},
        last_error = ${errorMessage},
        updated_at = NOW()
      WHERE id = ${jobId}
    `;
  }

  async markDeadLetter(jobId: string, reason: string): Promise<void> {
    const job = await this.getById(jobId);

    if (!job) {
      return;
    }

    await db.begin(async (tx) => {
      await tx`
        UPDATE worker.worker_jobs
        SET
          status = 'DEAD_LETTER',
          last_error = ${reason},
          updated_at = NOW()
        WHERE id = ${jobId}
      `;

      await tx`
        INSERT INTO worker.worker_dead_letters (
          id,
          job_id,
          business_key,
          payload_json,
          reason,
          created_at
        )
        VALUES (
          ${generateId()},
          ${jobId},
          ${job.businessKey},
          ${JSON.stringify(job.payloadJson)},
          ${reason},
          NOW()
        )
        ON CONFLICT (job_id) DO UPDATE
        SET
          reason = EXCLUDED.reason,
          payload_json = EXCLUDED.payload_json
      `;
    });
  }

  async addAttempt(
    jobId: string,
    attemptNo: number,
    status: string,
    errorMessage: string | null,
    durationMs: number,
  ) {
    await db`
      INSERT INTO worker.worker_job_attempts (
        id,
        job_id,
        attempt_no,
        status,
        error_message,
        duration_ms,
        created_at
      )
      VALUES (
        ${generateId()},
        ${jobId},
        ${attemptNo},
        ${status},
        ${errorMessage},
        ${durationMs},
        NOW()
      )
    `;
  }

  async retry(jobId: string): Promise<void> {
    await db`
      UPDATE worker.worker_jobs
      SET
        status = 'READY',
        next_run_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = ${jobId}
    `;
  }

  async cancel(jobId: string): Promise<void> {
    await db`
      UPDATE worker.worker_jobs
      SET
        status = 'CANCELED',
        updated_at = NOW()
      WHERE id = ${jobId}
    `;
  }

  async listDeadLetters(): Promise<WorkerDeadLetter[]> {
    return db.unsafe<WorkerDeadLetter[]>(workerSql.listDeadLetters);
  }
}
