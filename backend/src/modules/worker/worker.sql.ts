export const workerSql = {
  listJobs: `
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
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `,
  countJobs: `
    SELECT COUNT(*)::int AS total
    FROM worker.worker_jobs
  `,
  listDeadLetters: `
    SELECT
      id,
      job_id AS "jobId",
      business_key AS "businessKey",
      payload_json AS "payloadJson",
      reason,
      created_at AS "createdAt"
    FROM worker.worker_dead_letters
    ORDER BY created_at DESC
  `,
} as const;
