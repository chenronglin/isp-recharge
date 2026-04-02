import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db, executeFile } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;
const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

function buildSignedHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
}) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const method = input.method ?? 'POST';
  const bodyText = input.body ? stableStringify(input.body) : '';
  const canonical = buildOpenApiCanonicalString({
    method,
    path: input.path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function readResponseJson(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text) as {
      code: number;
      message: string;
      data: Record<string, any>;
      requestId: string;
    };
  } catch (error) {
    throw new Error(
      `Failed to parse JSON response (status ${response.status}): ${text || '<empty>'}`,
      { cause: error },
    );
  }
}

async function rebuildManagedSchemas() {
  await db.unsafe(`
    DROP SCHEMA IF EXISTS iam CASCADE;
    DROP SCHEMA IF EXISTS channel CASCADE;
    DROP SCHEMA IF EXISTS product CASCADE;
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS supplier CASCADE;
    DROP SCHEMA IF EXISTS ledger CASCADE;
    DROP SCHEMA IF EXISTS risk CASCADE;
    DROP SCHEMA IF EXISTS notification CASCADE;
    DROP SCHEMA IF EXISTS worker CASCADE;
    DROP TABLE IF EXISTS public.app_migrations;
  `);

  await executeFile(migrationFile);
}

async function resetTestState() {
  await db`
    TRUNCATE TABLE
      worker.worker_job_attempts,
      worker.worker_dead_letters,
      worker.worker_jobs,
      notification.notification_delivery_logs,
      notification.notification_dead_letters,
      notification.notification_tasks,
      channel.channel_request_nonces,
      risk.risk_decisions,
      supplier.supplier_callback_logs,
      supplier.supplier_orders,
      supplier.supplier_request_logs,
      ordering.order_events,
      ordering.orders,
      ledger.account_ledgers
  `;

  await runSeed(db);
}

async function processWorkerRound() {
  await db`
    UPDATE worker.worker_jobs
    SET
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE status IN ('READY', 'RETRY_WAIT')
  `;
  await runtime.services.worker.processReadyJobs();
}

async function withFixedNow<T>(iso: string, run: () => Promise<T>) {
  const originalNow = Date.now;
  const fixedMs = new Date(iso).getTime();

  Date.now = () => fixedMs;

  try {
    return await run();
  } finally {
    Date.now = originalNow;
  }
}

async function createOrder(input: {
  nowIso: string;
  productType: 'FAST' | 'MIXED';
  faceValue: number;
}) {
  return withFixedNow(input.nowIso, async () => {
    const body = {
      channelOrderNo: `itest-timeout-${input.productType.toLowerCase()}-${Date.now()}`,
      mobile: '13800130000',
      faceValue: input.faceValue,
      product_type: input.productType,
    };

    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(response.status).toBe(200);
    expect(json.code).toBe(0);

    return String(json.data.orderNo);
  });
}

async function removeSupplierSubmitJob(orderNo: string) {
  await db`
    DELETE FROM worker.worker_jobs
    WHERE job_type = 'supplier.submit'
      AND business_key = ${orderNo}
  `;
}

async function enqueueTimeoutScan(scanAt: Date) {
  await runtime.services.worker.enqueue({
    jobType: 'order.timeout.scan',
    businessKey: `scan:${scanAt.toISOString()}`,
    payload: {
      now: scanAt.toISOString(),
    },
  });

  await processWorkerRound();
}

async function listNotificationTasks(orderNo: string) {
  const rows = await db<
    {
      taskNo: string;
      notifyType: string;
      status: string;
      payloadText: string;
    }[]
  >`
    SELECT
      task_no AS "taskNo",
      notify_type AS "notifyType",
      status,
      payload_json::text AS "payloadText"
    FROM notification.notification_tasks
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;

  return rows.map((row) => {
    const firstPass = JSON.parse(row.payloadText) as string | Record<string, unknown>;
    const payload =
      typeof firstPass === 'string'
        ? (JSON.parse(firstPass) as Record<string, unknown>)
        : firstPass;

    return {
      taskNo: row.taskNo,
      notifyType: row.notifyType,
      status: row.status,
      triggerReason: typeof payload.triggerReason === 'string' ? payload.triggerReason : null,
      mainStatus: typeof payload.mainStatus === 'string' ? payload.mainStatus : null,
      refundStatus: typeof payload.refundStatus === 'string' ? payload.refundStatus : null,
    };
  });
}

async function countNotificationTasks(orderNo: string) {
  const rows = await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notification.notification_tasks
    WHERE order_no = ${orderNo}
  `;

  return rows[0]?.count ?? 0;
}

async function setLatestNotificationTaskStatus(orderNo: string, status: string) {
  await db`
    UPDATE notification.notification_tasks
    SET
      status = ${status},
      updated_at = NOW()
    WHERE task_no = (
      SELECT task_no
      FROM notification.notification_tasks
      WHERE order_no = ${orderNo}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
  `;
}

async function removeNotificationDeliverJobs(orderNo: string) {
  await db`
    DELETE FROM worker.worker_jobs
    WHERE job_type = 'notification.deliver'
      AND business_key IN (
        SELECT task_no
        FROM notification.notification_tasks
        WHERE order_no = ${orderNo}
      )
  `;
}

async function getOrderLedgerActions(orderNo: string) {
  return db<{ actionType: string }[]>`
    SELECT
      action_type AS "actionType"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

async function countSupplierOrders(orderNo: string) {
  const rows = await db<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM supplier.supplier_orders
    WHERE order_no = ${orderNo}
  `;

  return rows[0]?.count ?? 0;
}

async function setOrderState(
  orderNo: string,
  input: {
    mainStatus?: string;
    supplierStatus?: string;
    notifyStatus?: string;
    refundStatus?: string;
    monitorStatus?: string;
    warningDeadlineAt?: Date;
    expireDeadlineAt?: Date;
    finishedAt?: Date | null;
  },
) {
  await db`
    UPDATE ordering.orders
    SET
      main_status = COALESCE(${input.mainStatus ?? null}, main_status),
      supplier_status = COALESCE(${input.supplierStatus ?? null}, supplier_status),
      notify_status = COALESCE(${input.notifyStatus ?? null}, notify_status),
      refund_status = COALESCE(${input.refundStatus ?? null}, refund_status),
      monitor_status = COALESCE(${input.monitorStatus ?? null}, monitor_status),
      warning_deadline_at = COALESCE(${input.warningDeadlineAt ?? null}, warning_deadline_at),
      expire_deadline_at = COALESCE(${input.expireDeadlineAt ?? null}, expire_deadline_at),
      finished_at = CASE
        WHEN ${input.finishedAt === null} THEN NULL
        ELSE COALESCE(${input.finishedAt ?? null}, finished_at)
      END,
      updated_at = NOW()
    WHERE order_no = ${orderNo}
  `;
}

function countAction(entries: { actionType: string }[], actionType: string) {
  return entries.filter((entry) => entry.actionType === actionType).length;
}

function expectDeadlineIso(actual: string | null, expectedIso: string) {
  expect(actual).toBeTruthy();
  expect(new Date(String(actual)).toISOString()).toBe(expectedIso);
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  await runSeed(db);
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe.serial('V1 订单超时扫描', () => {
  test('FAST 订单创建时会派生 10 分钟预警和 1 小时过期 SLA', async () => {
    const createdAtIso = '2026-03-28T09:00:00.000Z';
    const orderNo = await createOrder({
      nowIso: createdAtIso,
      productType: 'FAST',
      faceValue: 100,
    });

    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expectDeadlineIso(order.warningDeadlineAt, '2026-03-28T09:10:00.000Z');
    expectDeadlineIso(order.expireDeadlineAt, '2026-03-28T10:00:00.000Z');
  });

  test('MIXED 订单创建时会派生 2.5 小时预警和 3 小时过期 SLA', async () => {
    const createdAtIso = '2026-03-28T09:00:00.000Z';
    const orderNo = await createOrder({
      nowIso: createdAtIso,
      productType: 'MIXED',
      faceValue: 50,
    });

    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expectDeadlineIso(order.warningDeadlineAt, '2026-03-28T11:30:00.000Z');
    expectDeadlineIso(order.expireDeadlineAt, '2026-03-28T12:00:00.000Z');
  });

  test('非终态订单不会创建终态 WEBHOOK 通知，V1 也不暴露内部手工通知入口', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'MIXED',
      faceValue: 50,
    });
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    await expect(
      runtime.services.notifications.handleNotificationRequested({
        orderNo,
        channelId: order.channelId,
        notifyType: 'WEBHOOK',
        triggerReason: 'ORDER_SUCCESS',
      }),
    ).rejects.toThrow('仅允许为终态订单创建对应通知');
    expect(await countNotificationTasks(orderNo)).toBe(0);

    const response = await runtime.app.handle(
      new Request('http://localhost/internal/notifications/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-internal-token',
        },
        body: JSON.stringify({
          orderNo,
          channelId: order.channelId,
          notifyType: 'WEBHOOK',
          destination: 'mock://success',
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(404);
  });

  test('FAST 订单超时后会按派生 SLA 先进入预警，再退款并仅创建终态 WEBHOOK 通知', async () => {
    const createdAtIso = '2026-03-28T09:00:00.000Z';
    const orderNo = await createOrder({
      nowIso: createdAtIso,
      productType: 'FAST',
      faceValue: 100,
    });

    await removeSupplierSubmitJob(orderNo);

    await enqueueTimeoutScan(new Date('2026-03-28T09:10:01.000Z'));

    const warnedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const warningTasks = await listNotificationTasks(orderNo);

    expect(warnedOrder.mainStatus).toBe('CREATED');
    expect(warnedOrder.refundStatus).toBe('NONE');
    expect(warnedOrder.monitorStatus).toBe('TIMEOUT_WARNING');
    expect(warningTasks).toHaveLength(0);

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);
    const pendingTasks = await listNotificationTasks(orderNo);

    expect(refundedOrder.mainStatus).toBe('REFUNDED');
    expect(refundedOrder.supplierStatus).toBe('FAIL');
    expect(refundedOrder.refundStatus).toBe('SUCCESS');
    expect(refundedOrder.monitorStatus).toBe('TIMEOUT_WARNING');
    expect(refundedOrder.notifyStatus).toBe('PENDING');
    expect(ledgerActions.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]).toMatchObject({
      notifyType: 'WEBHOOK',
      status: 'PENDING',
      triggerReason: 'REFUND_SUCCEEDED',
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
    });

    await processWorkerRound();

    const notifiedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const deliveredTasks = await listNotificationTasks(orderNo);

    expect(notifiedOrder.notifyStatus).toBe('SUCCESS');
    expect(deliveredTasks).toHaveLength(1);
    expect(deliveredTasks[0]?.notifyType).toBe('WEBHOOK');
    expect(deliveredTasks[0]?.status).toBe('SUCCESS');
  });

  test('已终态订单在超时扫描时不会被回退或再次退款', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'SUCCESS',
      supplierStatus: 'SUCCESS',
      refundStatus: 'NONE',
      notifyStatus: 'SUCCESS',
      monitorStatus: 'NORMAL',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
      finishedAt: new Date('2026-03-28T09:05:00.000Z'),
    });

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const scannedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);
    const notificationTasks = await listNotificationTasks(orderNo);

    expect(scannedOrder.mainStatus).toBe('SUCCESS');
    expect(scannedOrder.supplierStatus).toBe('SUCCESS');
    expect(scannedOrder.refundStatus).toBe('NONE');
    expect(scannedOrder.monitorStatus).toBe('NORMAL');
    expect(countAction(ledgerActions, 'ORDER_REFUND')).toBe(0);
    expect(notificationTasks).toHaveLength(0);
    expect(scannedOrder.channelId).toBe(order.channelId);
  });

  test('REFUNDING/PENDING 的超时订单在后续扫描会继续退款路径并避免重复退款', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'REFUNDING',
      supplierStatus: 'FAIL',
      refundStatus: 'PENDING',
      notifyStatus: 'PENDING',
      monitorStatus: 'TIMEOUT_WARNING',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
    });
    await runtime.services.ledger.refundOrderAmount({
      channelId: order.channelId,
      orderNo,
      amount: order.salePrice,
    });

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);
    const pendingTasks = await listNotificationTasks(orderNo);

    expect(refundedOrder.mainStatus).toBe('REFUNDED');
    expect(refundedOrder.refundStatus).toBe('SUCCESS');
    expect(countAction(ledgerActions, 'ORDER_REFUND')).toBe(2);
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]?.triggerReason).toBe('REFUND_SUCCEEDED');

    await processWorkerRound();

    const notifiedOrder = await runtime.services.orders.getOrderByNo(orderNo);

    expect(notifiedOrder.notifyStatus).toBe('SUCCESS');
  });

  test('REFUNDING/PENDING 期间的供应商迟到成功不会把订单重新推进为 SUCCESS', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'REFUNDING',
      supplierStatus: 'FAIL',
      refundStatus: 'PENDING',
      notifyStatus: 'PENDING',
      monitorStatus: 'TIMEOUT_WARNING',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
    });

    await runtime.services.orders.handleSupplierSucceeded({
      orderNo,
      supplierId: 'late-supplier',
      supplierOrderNo: 'late-success-order-no',
      costPrice: order.purchasePrice,
    });

    const afterLateSuccess = await runtime.services.orders.getOrderByNo(orderNo);
    expect(afterLateSuccess.mainStatus).toBe('REFUNDING');
    expect(afterLateSuccess.refundStatus).toBe('PENDING');
    expect(afterLateSuccess.supplierStatus).toBe('FAIL');

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);

    expect(refundedOrder.mainStatus).toBe('REFUNDED');
    expect(refundedOrder.refundStatus).toBe('SUCCESS');
    expect(countAction(ledgerActions, 'ORDER_REFUND')).toBe(2);
  });

  test('REFUNDING/PENDING 期间的供应商受理输入不会把订单拉回处理中', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'REFUNDING',
      supplierStatus: 'FAIL',
      refundStatus: 'PENDING',
      notifyStatus: 'PENDING',
      monitorStatus: 'TIMEOUT_WARNING',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
    });

    await runtime.services.suppliers.submitOrder({ orderNo });
    await runtime.services.orders.handleSupplierAccepted({
      orderNo,
      supplierId: 'late-supplier',
      supplierOrderNo: 'late-accepted-order-no',
      status: 'ACCEPTED',
    });
    await runtime.services.orders.handleSupplierAccepted({
      orderNo,
      supplierId: 'late-supplier',
      supplierOrderNo: 'late-processing-order-no',
      status: 'PROCESSING',
    });

    const afterLateAccepted = await runtime.services.orders.getOrderByNo(orderNo);

    expect(afterLateAccepted.mainStatus).toBe('REFUNDING');
    expect(afterLateAccepted.refundStatus).toBe('PENDING');
    expect(afterLateAccepted.supplierStatus).toBe('FAIL');
    expect(await countSupplierOrders(orderNo)).toBe(0);

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerActions = await getOrderLedgerActions(orderNo);

    expect(refundedOrder.mainStatus).toBe('REFUNDED');
    expect(refundedOrder.refundStatus).toBe('SUCCESS');
    expect(countAction(ledgerActions, 'ORDER_REFUND')).toBe(2);
  });

  test('REFUNDED 但未创建通知的超时订单在后续扫描会补建并继续终态通知', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'REFUNDED',
      supplierStatus: 'FAIL',
      refundStatus: 'SUCCESS',
      notifyStatus: 'PENDING',
      monitorStatus: 'TIMEOUT_WARNING',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
      finishedAt: new Date('2026-03-28T10:00:00.000Z'),
    });

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const pendingTasks = await listNotificationTasks(orderNo);

    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]).toMatchObject({
      notifyType: 'WEBHOOK',
      status: 'PENDING',
      triggerReason: 'REFUND_SUCCEEDED',
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
    });

    await processWorkerRound();

    const notifiedOrder = await runtime.services.orders.getOrderByNo(orderNo);

    expect(notifiedOrder.notifyStatus).toBe('SUCCESS');
  });

  test('REFUNDED 且最新终态通知已进死信时，后续超时扫描不会自动补建新任务', async () => {
    const orderNo = await createOrder({
      nowIso: '2026-03-28T09:00:00.000Z',
      productType: 'FAST',
      faceValue: 100,
    });
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    await removeSupplierSubmitJob(orderNo);
    await setOrderState(orderNo, {
      mainStatus: 'REFUNDED',
      supplierStatus: 'FAIL',
      refundStatus: 'SUCCESS',
      notifyStatus: 'DEAD_LETTER',
      monitorStatus: 'TIMEOUT_WARNING',
      warningDeadlineAt: new Date('2026-03-28T09:10:00.000Z'),
      expireDeadlineAt: new Date('2026-03-28T10:00:00.000Z'),
      finishedAt: new Date('2026-03-28T10:00:00.000Z'),
    });

    await runtime.services.notifications.handleNotificationRequested({
      orderNo,
      channelId: order.channelId,
      notifyType: 'WEBHOOK',
      triggerReason: 'REFUND_SUCCEEDED',
    });
    await setLatestNotificationTaskStatus(orderNo, 'DEAD_LETTER');
    await removeNotificationDeliverJobs(orderNo);

    const beforeTasks = await listNotificationTasks(orderNo);
    expect(beforeTasks).toHaveLength(1);
    expect(beforeTasks[0]?.status).toBe('DEAD_LETTER');

    await enqueueTimeoutScan(new Date('2026-03-28T10:00:01.000Z'));

    const afterTasks = await listNotificationTasks(orderNo);
    const scannedOrder = await runtime.services.orders.getOrderByNo(orderNo);

    expect(afterTasks).toHaveLength(1);
    expect(afterTasks[0]?.status).toBe('DEAD_LETTER');
    expect(scannedOrder.notifyStatus).toBe('DEAD_LETTER');
  });
});
