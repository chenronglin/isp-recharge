import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { notificationsSql } from '@/modules/notifications/notifications.sql';
import type {
  NotificationDeliveryLog,
  NotificationTask,
  NotificationTaskType,
} from '@/modules/notifications/notifications.types';

export class NotificationsRepository {
  private mapTask(row: NotificationTask): NotificationTask {
    return {
      ...row,
      payloadJson: parseJsonValue(row.payloadJson, {}),
    };
  }

  private mapDeliveryLog(row: NotificationDeliveryLog): NotificationDeliveryLog {
    return {
      ...row,
      requestPayloadJson: parseJsonValue(row.requestPayloadJson, {}),
    };
  }

  async listTasks(): Promise<NotificationTask[]> {
    const rows = await db.unsafe<NotificationTask[]>(notificationsSql.listTasks);
    return rows.map((row) => this.mapTask(row));
  }

  async findTaskByTaskNo(taskNo: string): Promise<NotificationTask | null> {
    const row = await first<NotificationTask>(db<NotificationTask[]>`
      SELECT
        id,
        task_no AS "taskNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        notify_type AS "notifyType",
        destination,
        payload_json AS "payloadJson",
        signature,
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        last_error AS "lastError"
      FROM notification.notification_tasks
      WHERE task_no = ${taskNo}
      LIMIT 1
    `);

    return row ? this.mapTask(row) : null;
  }

  async findLatestTaskByOrderNo(orderNo: string): Promise<NotificationTask | null> {
    const row = await first<NotificationTask>(db<NotificationTask[]>`
      SELECT
        id,
        task_no AS "taskNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        notify_type AS "notifyType",
        destination,
        payload_json AS "payloadJson",
        signature,
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        last_error AS "lastError"
      FROM notification.notification_tasks
      WHERE order_no = ${orderNo}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);

    return row ? this.mapTask(row) : null;
  }

  async listRecentDeliveryLogsByTaskNo(
    taskNo: string,
    limit = 10,
  ): Promise<NotificationDeliveryLog[]> {
    const rows = await db<NotificationDeliveryLog[]>`
      SELECT
        id,
        task_no AS "taskNo",
        request_payload_json AS "requestPayloadJson",
        response_status AS "responseStatus",
        response_body AS "responseBody",
        success,
        created_at AS "createdAt"
      FROM notification.notification_delivery_logs
      WHERE task_no = ${taskNo}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => this.mapDeliveryLog(row));
  }

  async createTask(input: {
    orderNo: string;
    channelId: string;
    notifyType: NotificationTaskType;
    destination: string;
    payloadJson: Record<string, unknown>;
    signature: string | null;
  }): Promise<NotificationTask> {
    const rows = await db<NotificationTask[]>`
      INSERT INTO notification.notification_tasks (
        id,
        task_no,
        order_no,
        channel_id,
        notify_type,
        destination,
        payload_json,
        signature,
        status,
        attempt_count,
        max_attempts,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${generateBusinessNo('notify')},
        ${input.orderNo},
        ${input.channelId},
        ${input.notifyType},
        ${input.destination},
        ${JSON.stringify(input.payloadJson)},
        ${input.signature},
        'PENDING',
        0,
        7,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        task_no AS "taskNo",
        order_no AS "orderNo",
        channel_id AS "channelId",
        notify_type AS "notifyType",
        destination,
        payload_json AS "payloadJson",
        signature,
        status,
        attempt_count AS "attemptCount",
        max_attempts AS "maxAttempts",
        last_error AS "lastError"
    `;

    const task = rows[0];

    if (!task) {
      throw new Error('创建通知任务失败');
    }

    return this.mapTask(task);
  }

  async addDeliveryLog(input: {
    taskNo: string;
    requestPayloadJson: Record<string, unknown>;
    responseStatus: string;
    responseBody: string;
    success: boolean;
  }): Promise<void> {
    await db`
      INSERT INTO notification.notification_delivery_logs (
        id,
        task_no,
        request_payload_json,
        response_status,
        response_body,
        success,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.taskNo},
        ${JSON.stringify(input.requestPayloadJson)},
        ${input.responseStatus},
        ${input.responseBody},
        ${input.success},
        NOW()
      )
    `;
  }

  async markSending(taskNo: string): Promise<void> {
    await db`
      UPDATE notification.notification_tasks
      SET
        status = 'SENDING',
        updated_at = NOW()
      WHERE task_no = ${taskNo}
    `;
  }

  async markSuccess(taskNo: string): Promise<void> {
    await db`
      UPDATE notification.notification_tasks
      SET
        status = 'SUCCESS',
        attempt_count = attempt_count + 1,
        next_retry_at = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE task_no = ${taskNo}
    `;
  }

  async markRetry(taskNo: string, errorMessage: string, nextRetryAt: Date): Promise<void> {
    await db`
      UPDATE notification.notification_tasks
      SET
        status = 'RETRYING',
        attempt_count = attempt_count + 1,
        last_error = ${errorMessage},
        next_retry_at = ${nextRetryAt},
        updated_at = NOW()
      WHERE task_no = ${taskNo}
    `;
  }

  async syncNextRetryAt(taskNo: string, nextRetryAt: Date): Promise<void> {
    await db`
      UPDATE notification.notification_tasks
      SET
        next_retry_at = ${nextRetryAt},
        updated_at = NOW()
      WHERE task_no = ${taskNo}
    `;
  }

  async markDeadLetter(taskNo: string, reason: string): Promise<void> {
    const task = await this.findTaskByTaskNo(taskNo);

    if (!task) {
      return;
    }

    await db.begin(async (tx) => {
      await tx`
        UPDATE notification.notification_tasks
        SET
          status = 'DEAD_LETTER',
          attempt_count = attempt_count + 1,
          next_retry_at = NULL,
          last_error = ${reason},
          updated_at = NOW()
        WHERE task_no = ${taskNo}
      `;

      await tx`
        INSERT INTO notification.notification_dead_letters (
          id,
          task_no,
          reason,
          created_at
        )
        VALUES (
          ${generateId()},
          ${taskNo},
          ${reason},
          NOW()
        )
        ON CONFLICT (task_no) DO UPDATE
        SET
          reason = EXCLUDED.reason
      `;
    });
  }

  async listDeadLetters() {
    return db`
      SELECT
        id,
        task_no AS "taskNo",
        reason,
        created_at AS "createdAt"
      FROM notification.notification_dead_letters
      ORDER BY created_at DESC
    `;
  }
}
