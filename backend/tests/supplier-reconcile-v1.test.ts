import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db, executeFile } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
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

function buildSignedHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  accessKey?: string;
  secretKey?: string;
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
    AccessKey: input.accessKey ?? 'demo-access-key',
    Sign: signOpenApiPayload(input.secretKey ?? 'demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
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

  for (const migrationFile of migrationFiles) {
    await executeFile(migrationFile);
  }
}

function normalizeJsonLike(input: unknown) {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }

  return (input ?? {}) as Record<string, unknown>;
}

async function readResponseJson(response: Response) {
  return (await response.json()) as {
    code: number;
    message: string;
    data: Record<string, unknown>;
    requestId: string;
  };
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

async function getDatabaseCurrentDate() {
  const rows = await db<{ currentDate: string }[]>`
    SELECT CURRENT_DATE::text AS "currentDate"
  `;

  return rows[0]?.currentDate ?? new Date().toISOString().slice(0, 10);
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

test('日对账任务会持久化平台退款但供应商成功的差异', async () => {
  const body = {
    channelOrderNo: `itest-reconcile-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
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
  const orderNo = String(json.data.orderNo);

  await processWorkerRound();
  await processWorkerRound();
  await processWorkerRound();

  await db`
    UPDATE ordering.orders
    SET
      main_status = 'REFUNDED',
      refund_status = 'SUCCESS',
      updated_at = NOW()
    WHERE order_no = ${orderNo}
  `;

  expect(runtime.services.worker.listRegisteredJobTypes().sort()).toEqual([
    'notification.deliver',
    'order.timeout.scan',
    'supplier.catalog.delta-sync',
    'supplier.catalog.full-sync',
    'supplier.query',
    'supplier.reconcile.daily',
    'supplier.reconcile.inflight',
    'supplier.submit',
  ]);

  await runtime.services.worker.enqueue({
    jobType: 'supplier.reconcile.daily',
    businessKey: `reconcile:${orderNo}`,
    payload: {
      reconcileDate: await getDatabaseCurrentDate(),
    },
  });
  await runtime.services.worker.processReadyJobs();

  const diffRows = await db<
    {
      diffType: string;
      diffAmount: string;
      detailsJson: Record<string, unknown>;
      status: string;
    }[]
  >`
    SELECT
      diff_type AS "diffType",
      diff_amount::text AS "diffAmount",
      details_json AS "detailsJson",
      status
    FROM supplier.supplier_reconcile_diffs
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC
  `;

  expect(diffRows).toHaveLength(1);
  expect(diffRows[0]).toMatchObject({
    diffType: 'PLATFORM_REFUNDED_SUPPLIER_SUCCESS',
    status: 'OPEN',
  });
  expect(Number(diffRows[0]?.diffAmount)).toBe(48);
  expect(normalizeJsonLike(diffRows[0]?.detailsJson)).toMatchObject({
    platformMainStatus: 'REFUNDED',
    supplierOrderStatus: 'SUCCESS',
  });
});

test('在途对账会识别平台处理中但供应商已成功的差异', async () => {
  const body = {
    channelOrderNo: `itest-inflight-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
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
  const orderNo = String(json.data.orderNo);

  await processWorkerRound();

  await db`
    UPDATE supplier.supplier_orders
    SET
      standard_status = 'SUCCESS',
      updated_at = NOW()
    WHERE order_no = ${orderNo}
  `;

  const diffs = await runtime.services.suppliers.runInflightReconcile();

  expect(diffs).toHaveLength(1);
  expect(diffs[0]).toMatchObject({
    orderNo,
    diffType: 'INFLIGHT_STATUS_MISMATCH',
  });
});

test('重复执行日对账不会写入重复差异', async () => {
  const body = {
    channelOrderNo: `itest-reconcile-dup-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
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
  const orderNo = String(json.data.orderNo);
  const reconcileDate = await getDatabaseCurrentDate();

  await processWorkerRound();
  await processWorkerRound();
  await processWorkerRound();

  await db`
    UPDATE ordering.orders
    SET
      main_status = 'REFUNDED',
      refund_status = 'SUCCESS',
      updated_at = NOW()
    WHERE order_no = ${orderNo}
  `;

  await Promise.all([
    runtime.services.suppliers.runDailyReconcile({ reconcileDate }),
    runtime.services.suppliers.runDailyReconcile({ reconcileDate }),
  ]);

  const rows = await db<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM supplier.supplier_reconcile_diffs
    WHERE order_no = ${orderNo}
      AND diff_type = 'PLATFORM_REFUNDED_SUPPLIER_SUCCESS'
  `;

  expect(rows[0]?.total).toBe(1);
});
