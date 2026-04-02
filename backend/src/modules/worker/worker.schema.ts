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

export const EnqueueJobBodySchema = t.Object({
  jobType: t.String({ minLength: 1 }),
  businessKey: t.String({ minLength: 1 }),
  payload: t.Record(t.String(), t.Unknown()),
  maxAttempts: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
  delaySeconds: t.Optional(t.Number({ minimum: 0, maximum: 3600 })),
});
