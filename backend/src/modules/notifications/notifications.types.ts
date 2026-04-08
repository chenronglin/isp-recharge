export type NotificationTaskType = 'WEBHOOK';

export type NotificationTaskStatus = 'PENDING' | 'SENDING' | 'SUCCESS' | 'RETRYING' | 'DEAD_LETTER';

export type NotificationTriggerReason = 'ORDER_SUCCESS' | 'REFUND_SUCCEEDED';

export interface NotificationTask {
  id: string;
  taskNo: string;
  orderNo: string;
  channelId: string;
  notifyType: NotificationTaskType;
  destination: string;
  payloadJson: Record<string, unknown>;
  signature: string | null;
  status: NotificationTaskStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryLog {
  id: string;
  taskNo: string;
  requestPayloadJson: Record<string, unknown>;
  responseStatus: string;
  responseBody: string;
  success: boolean;
  createdAt: string;
}

export interface NotificationTaskDetail {
  basicInfo: {
    taskNo: string;
    orderNo: string;
    channelId: string;
    notifyType: NotificationTaskType;
    destination: string;
    status: NotificationTaskStatus;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  deliverySummary: {
    latestDeliveryAt: string | null;
    latestResponseStatus: string | null;
    successCount: number;
    failureCount: number;
  };
  payloadSnapshot: Record<string, unknown>;
}

export interface NotificationDeadLetter {
  id: string;
  taskNo: string;
  reason: string;
  createdAt: string;
}
