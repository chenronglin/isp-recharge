import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const CreateNotificationBodySchema = t.Object({
  orderNo: t.String(),
  channelId: t.String(),
  notifyType: t.String({ minLength: 1 }),
  destination: t.String({ minLength: 1 }),
  payload: t.Record(t.String(), t.Unknown()),
});

export const NotificationsTaskListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
  taskNo: t.Optional(t.String({ minLength: 1 })),
  bizNo: t.Optional(t.String({ minLength: 1 })),
  deliveryStatus: t.Optional(t.String({ minLength: 1 })),
});

export const NotificationDeadLetterListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const NotificationDeliveryLogsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const NotificationTaskSchema = t.Object({
  taskNo: t.String(),
  orderNo: t.String(),
  channelId: t.String(),
  notifyType: t.String(),
  destination: t.String(),
  status: t.String(),
  attemptCount: t.Number(),
  maxAttempts: t.Number(),
  lastError: t.Nullable(t.String()),
  nextRetryAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const NotificationDeliveryLogSchema = t.Object({
  id: t.String(),
  taskNo: t.String(),
  requestPayloadJson: t.Record(t.String(), t.Unknown()),
  responseStatus: t.String(),
  responseBody: t.String(),
  success: t.Boolean(),
  createdAt: t.String({ format: 'date-time' }),
});

export const NotificationTaskDetailSchema = t.Object({
  basicInfo: t.Object({
    taskNo: t.String(),
    orderNo: t.String(),
    channelId: t.String(),
    notifyType: t.String(),
    destination: t.String(),
    status: t.String(),
    attemptCount: t.Number(),
    maxAttempts: t.Number(),
    lastError: t.Nullable(t.String()),
    nextRetryAt: t.Nullable(t.String({ format: 'date-time' })),
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
  }),
  deliverySummary: t.Object({
    latestDeliveryAt: t.Nullable(t.String({ format: 'date-time' })),
    latestResponseStatus: t.Nullable(t.String()),
    successCount: t.Number(),
    failureCount: t.Number(),
  }),
  payloadSnapshot: t.Record(t.String(), t.Unknown()),
});

export const NotificationDeadLetterSchema = t.Object({
  id: t.String(),
  taskNo: t.String(),
  reason: t.String(),
  createdAt: t.String({ format: 'date-time' }),
});

export const RetryNotificationTaskBodySchema = t.Object({
  reason: t.String({ minLength: 1 }),
});
