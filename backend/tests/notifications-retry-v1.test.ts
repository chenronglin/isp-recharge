import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { buildSeedRechargeProductId, runSeed } from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;
const migrationFiles = [
  join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql'),
  join(import.meta.dir, '../src/database/migrations/0002_add_login_sessions.sql'),
  join(import.meta.dir, '../src/database/migrations/0003_add_admin_security_logs.sql'),
];
const retryBackoffInMinutes = [0, 1, 5, 15, 30, 60] as const;
const retryLowerJitterMs = 5_000;
const retryUpperJitterMs = 20_000;

beforeAll(async () => {
  await acquireIntegrationTestLock();
  for (const migrationFile of migrationFiles) {
    await executeFile(migrationFile);
  }
  await runSeed(db);
  runtime = await buildApp({ startWorkerScheduler: false });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(async () => {
  runtime?.stop();
  await releaseIntegrationTestLock();
});

async function createFailingNotificationTask(taskNo: string, orderNo: string) {
  await db`
    INSERT INTO notification.notification_tasks (
      id, task_no, order_no, channel_id, notify_type, destination, payload_json, signature,
      status, attempt_count, max_attempts, created_at, updated_at
    )
    VALUES (
      ${`itest-notify-task-${taskNo}`},
      ${taskNo},
      ${orderNo},
      'seed-channel-demo',
      'WEBHOOK',
      'mock://fail',
      ${JSON.stringify({ orderNo, triggerReason: 'ORDER_SUCCESS' })},
      'signed',
      'PENDING',
      0,
      7,
      NOW(),
      NOW()
    )
  `;
}

async function enqueueDeliverJob(taskNo: string) {
  await runtime.services.worker.enqueue({
    jobType: 'notification.deliver',
    businessKey: taskNo,
    payload: { taskNo },
    maxAttempts: 7,
  });
}

async function readTaskAndJob(taskNo: string) {
  const taskRows = await db<
    {
      status: string;
      attemptCount: number;
      nextRetryAt: string | null;
    }[]
  >`
    SELECT
      status,
      attempt_count AS "attemptCount",
      next_retry_at::text AS "nextRetryAt"
    FROM notification.notification_tasks
    WHERE task_no = ${taskNo}
  `;

  const jobRows = await db<
    {
      status: string;
      nextRunAt: string;
    }[]
  >`
    SELECT
      status,
      next_run_at::text AS "nextRunAt"
    FROM worker.worker_jobs
    WHERE job_type = 'notification.deliver'
      AND business_key = ${taskNo}
  `;

  return {
    task: taskRows[0],
    job: jobRows[0],
  };
}

async function forceNotificationDeliverJobReady(taskNo: string) {
  await db`
    UPDATE worker.worker_jobs
    SET
      status = 'READY',
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE job_type = 'notification.deliver'
      AND business_key = ${taskNo}
  `;
}

async function createNotificationOrder(orderNo: string) {
  const guangdongMixed50ProductId = buildSeedRechargeProductId({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  });

  await db`
    INSERT INTO ordering.orders (
      id,
      order_no,
      channel_order_no,
      channel_id,
      product_id,
      mobile_number,
      province_name,
      isp_code,
      face_value,
      sale_price,
      cost_price,
      main_status,
      payment_status,
      supplier_status,
      notify_status,
      risk_status,
      request_id,
      created_at,
      updated_at
    )
    VALUES (
      ${`itest-order-${orderNo}`},
      ${orderNo},
      ${`channel-${orderNo}`},
      'seed-channel-demo',
      ${guangdongMixed50ProductId},
      '13800130000',
      '广东',
      'CMCC',
      50,
      48,
      45,
      'SUCCESS',
      'PAID',
      'SUCCESS',
      'PENDING',
      'PASS',
      ${`req-${orderNo}`},
      NOW(),
      NOW()
    )
  `;
}

test('worker path schedules full six-window retry tiers then dead-letters on boundary', async () => {
  const orderNo = 'seed-order-for-retry';
  const taskNo = 'notify-itest-1';

  await createFailingNotificationTask(taskNo, orderNo);
  await enqueueDeliverJob(taskNo);

  for (let index = 0; index < retryBackoffInMinutes.length; index += 1) {
    const expectedMinutes = retryBackoffInMinutes[index];
    const beforeProcessAt = Date.now();

    await runtime.services.worker.processReadyJobs();

    const state = await readTaskAndJob(taskNo);

    expect(state.task?.status).toBe('RETRYING');
    expect(state.task?.attemptCount).toBe(index + 1);
    expect(state.task?.nextRetryAt).toBeTruthy();
    expect(state.job?.status).toBe('RETRY_WAIT');
    expect(state.job?.status).not.toBe('SUCCESS');

    const taskRetryAtMs = new Date(String(state.task?.nextRetryAt)).getTime();
    const workerNextRunAtMs = new Date(String(state.job?.nextRunAt)).getTime();
    const expectedDelayMs = expectedMinutes * 60_000;

    expect(Math.abs(taskRetryAtMs - workerNextRunAtMs)).toBeLessThan(2_000);
    const scheduledDelayMs = taskRetryAtMs - beforeProcessAt;
    const lowerBoundMs = Math.max(0, expectedDelayMs - retryLowerJitterMs);
    const upperBoundMs = expectedDelayMs + retryUpperJitterMs;

    expect(scheduledDelayMs).toBeGreaterThanOrEqual(lowerBoundMs);
    expect(scheduledDelayMs).toBeLessThanOrEqual(upperBoundMs);

    await forceNotificationDeliverJobReady(taskNo);
  }

  await runtime.services.worker.processReadyJobs();

  const finalState = await readTaskAndJob(taskNo);
  const deadLetterRows = await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notification.notification_dead_letters
    WHERE task_no = ${taskNo}
  `;

  expect(finalState.task?.status).toBe('DEAD_LETTER');
  expect(finalState.task?.attemptCount).toBe(7);
  expect(finalState.task?.nextRetryAt).toBeNull();
  expect(['SUCCESS', 'DEAD_LETTER']).toContain(finalState.job?.status);
  expect(deadLetterRows[0]?.count).toBe(1);
});

test('manual retry keeps notification and worker next run times aligned', async () => {
  const taskNo = 'notify-itest-manual-retry';
  const orderNo = 'seed-order-for-retry';
  const delayedRetryAt = new Date(Date.now() + 5 * 60 * 1000);

  await createFailingNotificationTask(taskNo, orderNo);
  await enqueueDeliverJob(taskNo);
  await db`
    UPDATE notification.notification_tasks
    SET
      status = 'RETRYING',
      attempt_count = 2,
      next_retry_at = ${delayedRetryAt},
      updated_at = NOW()
    WHERE task_no = ${taskNo}
  `;
  await db`
    UPDATE worker.worker_jobs
    SET
      status = 'RETRY_WAIT',
      next_run_at = ${delayedRetryAt},
      updated_at = NOW()
    WHERE job_type = 'notification.deliver'
      AND business_key = ${taskNo}
  `;

  const beforeRetryAt = Date.now();
  await runtime.services.notifications.retryTask(taskNo);
  const afterRetryAt = Date.now();

  const state = await readTaskAndJob(taskNo);
  const taskRetryAtMs = new Date(String(state.task?.nextRetryAt)).getTime();
  const workerNextRunAtMs = new Date(String(state.job?.nextRunAt)).getTime();

  expect(state.task?.status).toBe('RETRYING');
  expect(state.task?.nextRetryAt).toBeTruthy();
  expect(['READY', 'RETRY_WAIT']).toContain(state.job?.status);
  expect(Math.abs(taskRetryAtMs - workerNextRunAtMs)).toBeLessThan(2_000);
  expect(taskRetryAtMs).toBeGreaterThanOrEqual(beforeRetryAt - 2_000);
  expect(taskRetryAtMs).toBeLessThanOrEqual(afterRetryAt + 10_000);
});

test('manual retry aligns next retry time with existing RUNNING worker job', async () => {
  const taskNo = 'notify-itest-manual-retry-running';
  const orderNo = 'seed-order-for-retry';
  const runningNextRunAt = new Date(Date.now() + 8 * 60 * 1000);

  await createFailingNotificationTask(taskNo, orderNo);
  await enqueueDeliverJob(taskNo);
  await db`
    UPDATE notification.notification_tasks
    SET
      status = 'RETRYING',
      attempt_count = 3,
      next_retry_at = NOW(),
      updated_at = NOW()
    WHERE task_no = ${taskNo}
  `;
  await db`
    UPDATE worker.worker_jobs
    SET
      status = 'RUNNING',
      next_run_at = ${runningNextRunAt},
      updated_at = NOW()
    WHERE job_type = 'notification.deliver'
      AND business_key = ${taskNo}
  `;

  await runtime.services.notifications.retryTask(taskNo);

  const state = await readTaskAndJob(taskNo);
  const taskRetryAtMs = new Date(String(state.task?.nextRetryAt)).getTime();
  const workerNextRunAtMs = new Date(String(state.job?.nextRunAt)).getTime();
  const expectedRunningNextRunAtMs = runningNextRunAt.getTime();

  expect(state.task?.status).toBe('RETRYING');
  expect(state.job?.status).toBe('RUNNING');
  expect(workerNextRunAtMs).toBeGreaterThanOrEqual(expectedRunningNextRunAtMs - 2_000);
  expect(workerNextRunAtMs).toBeLessThanOrEqual(expectedRunningNextRunAtMs + 2_000);
  expect(Math.abs(taskRetryAtMs - workerNextRunAtMs)).toBeLessThan(2_000);
});

test('successful delivery clears notification next retry timestamp', async () => {
  const taskNo = 'notify-itest-success-clear';
  const orderNo = 'seed-order-for-retry';
  const staleRetryAt = new Date(Date.now() + 10 * 60 * 1000);

  await createNotificationOrder(orderNo);
  await db`
    INSERT INTO notification.notification_tasks (
      id, task_no, order_no, channel_id, notify_type, destination, payload_json, signature,
      status, attempt_count, max_attempts, next_retry_at, created_at, updated_at
    )
    VALUES (
      'itest-notify-success-clear',
      ${taskNo},
      ${orderNo},
      'seed-channel-demo',
      'WEBHOOK',
      'mock://success',
      ${JSON.stringify({ orderNo, triggerReason: 'ORDER_SUCCESS' })},
      'signed',
      'RETRYING',
      1,
      7,
      ${staleRetryAt},
      NOW(),
      NOW()
    )
  `;

  await enqueueDeliverJob(taskNo);
  await runtime.services.worker.processReadyJobs();

  const state = await readTaskAndJob(taskNo);

  expect(state.task?.status).toBe('SUCCESS');
  expect(state.task?.nextRetryAt).toBeNull();
  expect(state.job?.status).toBe('SUCCESS');
});
