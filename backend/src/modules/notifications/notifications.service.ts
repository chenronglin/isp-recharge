import { badRequest, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { decryptText, signOpenApiPayload } from '@/lib/security';
import { toIsoDateTime } from '@/lib/utils';
import type { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import type {
  NotificationDeadLetter,
  NotificationDeliveryLog,
  NotificationTaskType,
  NotificationTriggerReason,
} from '@/modules/notifications/notifications.types';
import {
  notificationWorkerMaxAttempts,
  retryBackoffInMinutes,
} from '@/modules/notifications/retry-policy';
import type { OrderContract } from '@/modules/orders/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

type RetryableDeliveryError = Error & {
  retryable: true;
  nextRetryAt: Date;
};

function resolveNextRetryAt(attemptCount: number): Date {
  const minutes = retryBackoffInMinutes[Math.min(attemptCount, retryBackoffInMinutes.length - 1)];
  return new Date(Date.now() + minutes * 60 * 1000);
}

function createRetryableDeliveryError(message: string, nextRetryAt: Date): RetryableDeliveryError {
  const error = new Error(message) as RetryableDeliveryError;

  error.retryable = true;
  error.nextRetryAt = nextRetryAt;

  return error;
}

export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly orderContract: OrderContract,
    private readonly workerContract: WorkerContract,
  ) {}

  private toTaskListItem(task: {
    taskNo: string;
    orderNo: string;
    channelId: string;
    notifyType: string;
    destination: string;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    lastError: string | null;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
  }) {
    return {
      taskNo: task.taskNo,
      orderNo: task.orderNo,
      channelId: task.channelId,
      notifyType: task.notifyType,
      destination: task.destination,
      status: task.status,
      attemptCount: task.attemptCount,
      maxAttempts: task.maxAttempts,
      lastError: task.lastError,
      nextRetryAt: toIsoDateTime(task.nextRetryAt),
      createdAt: toIsoDateTime(task.createdAt) ?? task.createdAt,
      updatedAt: toIsoDateTime(task.updatedAt) ?? task.updatedAt,
    };
  }

  async listTasks(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    taskNo?: string;
    bizNo?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listTasks(input);

    return {
      items: result.items.map((item) => this.toTaskListItem(item)),
      total: result.total,
    };
  }

  async getTaskDetail(taskNo: string) {
    const task = await this.repository.findTaskByTaskNo(taskNo);

    if (!task) {
      throw notFound('通知任务不存在');
    }

    const recentLogs = await this.repository.listRecentDeliveryLogsByTaskNo(taskNo, 20);
    const latestDelivery = recentLogs[0] ?? null;

    return {
      basicInfo: this.toTaskListItem(task),
      deliverySummary: {
        latestDeliveryAt: latestDelivery ? (toIsoDateTime(latestDelivery.createdAt) ?? latestDelivery.createdAt) : null,
        latestResponseStatus: latestDelivery?.responseStatus ?? null,
        successCount: recentLogs.filter((item) => item.success).length,
        failureCount: recentLogs.filter((item) => !item.success).length,
      },
      payloadSnapshot: task.payloadJson,
    };
  }

  async listDeliveryLogs(input: {
    taskNo: string;
    pageNum: number;
    pageSize: number;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listDeliveryLogs(input);

    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      })),
      total: result.total,
    };
  }

  async listDeadLetters(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listDeadLetters(input);

    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      })),
      total: result.total,
    };
  }

  async handleNotificationRequested(input: {
    orderNo: string;
    channelId: string;
    notifyType: NotificationTaskType;
    triggerReason: NotificationTriggerReason;
  }) {
    const order = await this.orderContract.getNotificationContext(input.orderNo);

    if (
      (input.triggerReason === 'ORDER_SUCCESS' && order.mainStatus !== 'SUCCESS') ||
      (input.triggerReason === 'REFUND_SUCCEEDED' &&
        (order.mainStatus !== 'REFUNDED' || order.refundStatus !== 'SUCCESS'))
    ) {
      throw badRequest('仅允许为终态订单创建对应通知');
    }

    const callbackConfig = order.callbackSnapshotJson.callbackConfig as Record<string, unknown>;
    const payload = {
      orderNo: order.orderNo,
      mainStatus: order.mainStatus,
      supplierStatus: order.supplierStatus,
      notifyStatus: order.notifyStatus,
      refundStatus: order.refundStatus,
      triggerReason: input.triggerReason,
    };
    const existingTask = await this.repository.findLatestTaskByOrderNo(order.orderNo);

    if (existingTask?.status === 'SUCCESS') {
      return;
    }

    if (existingTask?.status === 'DEAD_LETTER') {
      return;
    }

    if (existingTask && ['PENDING', 'SENDING', 'RETRYING'].includes(existingTask.status)) {
      await this.workerContract.enqueue({
        jobType: 'notification.deliver',
        businessKey: existingTask.taskNo,
        payload: {
          taskNo: existingTask.taskNo,
        },
        maxAttempts: notificationWorkerMaxAttempts,
      });
      return;
    }

    const destination = String(callbackConfig.callbackUrl ?? 'mock://success');
    const secret = decryptText(String(callbackConfig.secretEncrypted));
    const signature = signOpenApiPayload(secret, JSON.stringify(payload));
    const task = await this.repository.createTask({
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType: input.notifyType,
      destination,
      payloadJson: payload,
      signature,
    });

    await this.workerContract.enqueue({
      jobType: 'notification.deliver',
      businessKey: task.taskNo,
      payload: {
        taskNo: task.taskNo,
      },
      maxAttempts: notificationWorkerMaxAttempts,
    });
  }

  async handleDeliverJob(payload: Record<string, unknown>) {
    const taskNo = String(payload.taskNo ?? '');
    const task = await this.repository.findTaskByTaskNo(taskNo);

    if (!task) {
      throw new Error('通知任务不存在');
    }

    if (task.status === 'SUCCESS') {
      return;
    }

    await this.repository.markSending(task.taskNo);

    try {
      if (task.destination.startsWith('mock://success')) {
        await this.repository.addDeliveryLog({
          taskNo: task.taskNo,
          requestPayloadJson: task.payloadJson,
          responseStatus: '200',
          responseBody: 'mock success',
          success: true,
        });
        await this.repository.markSuccess(task.taskNo);
        await eventBus.publish('NotificationSucceeded', {
          orderNo: task.orderNo,
          taskNo: task.taskNo,
        });
        return;
      }

      if (task.destination.startsWith('mock://fail')) {
        throw new Error('mock fail');
      }

      const response = await fetch(task.destination, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': task.signature ?? '',
        },
        body: JSON.stringify(task.payloadJson),
      });
      const responseBody = await response.text();

      await this.repository.addDeliveryLog({
        taskNo: task.taskNo,
        requestPayloadJson: task.payloadJson,
        responseStatus: String(response.status),
        responseBody,
        success: response.ok,
      });

      if (!response.ok) {
        throw new Error(`回调返回非 2xx 状态: ${response.status}`);
      }

      await this.repository.markSuccess(task.taskNo);
      await eventBus.publish('NotificationSucceeded', {
        orderNo: task.orderNo,
        taskNo: task.taskNo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '通知发送失败';

      if (task.attemptCount + 1 >= task.maxAttempts) {
        await this.repository.markDeadLetter(task.taskNo, message);
        await eventBus.publish('NotificationFailed', {
          orderNo: task.orderNo,
          taskNo: task.taskNo,
          reason: message,
        });
        return;
      }

      const nextRetryAt = resolveNextRetryAt(task.attemptCount);
      await this.repository.markRetry(task.taskNo, message, nextRetryAt);
      throw createRetryableDeliveryError(message, nextRetryAt);
    }
  }

  async retryTask(taskNo: string) {
    const requestedRetryAt = new Date();
    const scheduledJob = await this.workerContract.schedule({
      jobType: 'notification.deliver',
      businessKey: taskNo,
      payload: {
        taskNo,
      },
      nextRunAt: requestedRetryAt,
      maxAttempts: notificationWorkerMaxAttempts,
    });
    await this.repository.syncNextRetryAt(taskNo, new Date(scheduledJob.nextRunAt));
  }
}
