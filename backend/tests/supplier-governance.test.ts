import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

const mockSupplierId = 'seed-supplier-mock';

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

async function createOpenOrder(channelOrderNo: string) {
  const body = {
    channelOrderNo,
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
  const payload = (await response.json()) as {
    code: number;
    data: {
      orderNo: string;
    };
  };

  expect(response.status).toBe(200);
  expect(payload.code).toBe(0);

  return payload.data.orderNo;
}

async function processSupplierJobsRound() {
  await db`
    UPDATE worker.worker_jobs
    SET
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE status IN ('READY', 'RETRY_WAIT')
      AND job_type IN ('supplier.submit', 'supplier.query')
  `;
  await runtime.services.worker.processReadyJobs();
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  runtime = await buildApp({ startWorkerScheduler: false });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(() => {
  runtime.stop();
  return releaseIntegrationTestLock();
});

test('供应商提单与查单会完整写入 supplier_request_logs', async () => {
  const orderNo = await createOpenOrder(`itest-supplier-logs-${Date.now()}`);

  await processSupplierJobsRound();
  await processSupplierJobsRound();

  const rows = await db<
    {
      requestStatus: string;
      attemptNo: number;
      orderNo: string | null;
    }[]
  >`
    SELECT
      request_status AS "requestStatus",
      attempt_no AS "attemptNo",
      order_no AS "orderNo"
    FROM supplier.supplier_request_logs
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;

  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    requestStatus: 'SUCCESS',
    attemptNo: 1,
    orderNo,
  });
  expect(rows[1]).toMatchObject({
    requestStatus: 'SUCCESS',
    attemptNo: 1,
    orderNo,
  });
});

test('连续协议失败会触发熔断，恢复后可重新参与自动路由', async () => {
  await db`
    UPDATE supplier.supplier_configs
    SET
      config_json = '{"mode":"mock-auto-fail"}'::jsonb,
      updated_at = NOW()
    WHERE supplier_id = ${mockSupplierId}
  `;

  for (let index = 0; index < 3; index += 1) {
    await createOpenOrder(`itest-breaker-open-${Date.now()}-${index}`);
    await processSupplierJobsRound();
    await processSupplierJobsRound();
  }

  const breakerRows = await db<
    {
      breakerStatus: string;
      failCountWindow: number;
    }[]
  >`
    SELECT
      breaker_status AS "breakerStatus",
      fail_count_window AS "failCountWindow"
    FROM supplier.supplier_runtime_breakers
    WHERE supplier_id = ${mockSupplierId}
    LIMIT 1
  `;

  expect(breakerRows[0]).toMatchObject({
    breakerStatus: 'OPEN',
  });
  expect(Number(breakerRows[0]?.failCountWindow)).toBeGreaterThanOrEqual(3);

  const blockedOrderNo = await createOpenOrder(`itest-breaker-blocked-${Date.now()}`);
  await processSupplierJobsRound();

  const blockedSubmitRows = await db<
    {
      status: string;
      lastError: string | null;
    }[]
  >`
    SELECT
      status,
      last_error AS "lastError"
    FROM worker.worker_jobs
    WHERE job_type = 'supplier.submit'
      AND business_key = ${blockedOrderNo}
    LIMIT 1
  `;

  expect(blockedSubmitRows[0]).toMatchObject({
    status: 'RETRY_WAIT',
  });
  expect(String(blockedSubmitRows[0]?.lastError ?? '')).toContain('可用供应商候选映射');

  await runtime.services.suppliers.recoverCircuitBreaker({
    supplierId: mockSupplierId,
  });

  await db`
    UPDATE supplier.supplier_configs
    SET
      config_json = '{"mode":"mock-auto-success"}'::jsonb,
      updated_at = NOW()
    WHERE supplier_id = ${mockSupplierId}
  `;

  await processSupplierJobsRound();

  const supplierOrderRows = await db<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM supplier.supplier_orders
    WHERE order_no = ${blockedOrderNo}
  `;
  const recoveredBreakerRows = await db<{ breakerStatus: string }[]>`
    SELECT breaker_status AS "breakerStatus"
    FROM supplier.supplier_runtime_breakers
    WHERE supplier_id = ${mockSupplierId}
    LIMIT 1
  `;

  expect(supplierOrderRows[0]?.total).toBe(1);
  expect(recoveredBreakerRows[0]?.breakerStatus).toBe('CLOSED');
});
