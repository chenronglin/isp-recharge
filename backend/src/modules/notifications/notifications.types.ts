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
}
