export const notificationsSql = {
  listTasks: `
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
    ORDER BY created_at DESC
  `,
} as const;
