import { t } from 'elysia';

export const WorkerJobSchema = t.Object({
  id: t.String(),
  jobType: t.String(),
  businessKey: t.String(),
  payloadJson: t.Record(t.String(), t.Unknown()),
  status: t.String(),
  attemptCount: t.Number(),
  maxAttempts: t.Number(),
  nextRunAt: t.String(),
  lastError: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const WorkerJobAttemptSchema = t.Object({
  id: t.String(),
  jobId: t.String(),
  attemptNo: t.Number(),
  status: t.String(),
  errorMessage: t.Nullable(t.String()),
  durationMs: t.Number(),
  createdAt: t.String(),
});

export const WorkerJobItemSchema = t.Object({
  id: t.String(),
  jobId: t.String(),
  itemNo: t.String(),
  status: t.String(),
  payloadJson: t.Record(t.String(), t.Unknown()),
  resultJson: t.Record(t.String(), t.Unknown()),
  errorMessage: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const WorkerJobArtifactSchema = t.Object({
  id: t.String(),
  jobId: t.String(),
  artifactType: t.String(),
  fileName: t.String(),
  filePath: t.String(),
  downloadUrl: t.String(),
  createdAt: t.String(),
});

export const WorkerJobDetailSchema = t.Object({
  job: WorkerJobSchema,
  attempts: t.Array(WorkerJobAttemptSchema),
  items: t.Array(WorkerJobItemSchema),
  artifacts: t.Array(WorkerJobArtifactSchema),
});

export const EnqueueJobBodySchema = t.Object({
  jobType: t.String({ minLength: 1 }),
  businessKey: t.String({ minLength: 1 }),
  payload: t.Record(t.String(), t.Unknown()),
  maxAttempts: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
  delaySeconds: t.Optional(t.Number({ minimum: 0, maximum: 3600 })),
});
