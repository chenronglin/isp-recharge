import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import iconv from 'iconv-lite';

import { buildApp } from '@/app';
import {
  buildSeedMockSupplierProductCode,
  buildSeedRechargeProductCode,
  buildSeedRechargeProductId,
  runSeed,
} from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, encryptText, signOpenApiPayload } from '@/lib/security';
import { db, executeFile } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import { OrdersRepository } from '@/modules/orders/orders.repository';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

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

function buildSupplierCallbackHeaders(input: {
  body: Record<string, unknown>;
  secret?: string;
  signature?: string;
}) {
  const bodyText = stableStringify(input.body);

  return {
    'content-type': 'application/json',
    Sign: input.signature ?? signOpenApiPayload(input.secret ?? 'mock-supplier-callback', bodyText),
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

async function getOrderLedgerEntries(orderNo: string) {
  return db<
    {
      actionType: string;
      direction: string;
      amount: string;
      referenceNo: string;
    }[]
  >`
    SELECT
      action_type AS "actionType",
      direction,
      amount::text AS amount,
      reference_no AS "referenceNo"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

async function getOrderEventTypes(orderNo: string) {
  return db<
    {
      eventType: string;
    }[]
  >`
    SELECT
      event_type AS "eventType"
    FROM ordering.order_events
    WHERE order_no = ${orderNo}
    ORDER BY occurred_at ASC, id ASC
  `;
}

async function getOrderByChannelOrder(channelId: string, channelOrderNo: string) {
  return db<
    {
      orderNo: string;
      mainStatus: string;
    }[]
  >`
    SELECT
      order_no AS "orderNo",
      main_status AS "mainStatus"
    FROM ordering.orders
    WHERE channel_id = ${channelId}
      AND channel_order_no = ${channelOrderNo}
    LIMIT 1
  `;
}

async function getStoredOrderState(orderNo: string) {
  return db<
    {
      refundStatus: string;
      monitorStatus: string;
      requestedProductType: string;
      warningDeadlineAt: string | null;
      expireDeadlineAt: string | null;
      channelSnapshotJson: Record<string, unknown>;
      productSnapshotJson: Record<string, unknown>;
      callbackSnapshotJson: Record<string, unknown>;
      supplierRouteSnapshotJson: Record<string, unknown>;
      riskSnapshotJson: Record<string, unknown>;
      extJson: Record<string, unknown>;
    }[]
  >`
    SELECT
      refund_status AS "refundStatus",
      monitor_status AS "monitorStatus",
      requested_product_type AS "requestedProductType",
      channel_snapshot_json AS "channelSnapshotJson",
      product_snapshot_json AS "productSnapshotJson",
      callback_snapshot_json AS "callbackSnapshotJson",
      supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
      risk_snapshot_json AS "riskSnapshotJson",
      warning_deadline_at::text AS "warningDeadlineAt",
      expire_deadline_at::text AS "expireDeadlineAt",
      ext_json AS "extJson"
    FROM ordering.orders
    WHERE order_no = ${orderNo}
    LIMIT 1
  `;
}

function normalizeJsonLike(input: unknown) {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }

  return (input ?? {}) as Record<string, unknown>;
}

async function getDemoChannelId() {
  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM channel.channels
    WHERE channel_code = 'demo-channel'
    LIMIT 1
  `;

  return rows[0]?.id ?? null;
}

async function setChannelBalance(channelId: string, amount: number) {
  await db`
    UPDATE ledger.accounts
    SET
      available_balance = ${amount},
      updated_at = NOW()
    WHERE owner_type = 'CHANNEL'
      AND owner_id = ${channelId}
  `;
}

async function seedSecondChannel() {
  const secret = encryptText('other-secret-key');

  await db`
    INSERT INTO channel.channels (
      id,
      channel_code,
      channel_name,
      channel_type,
      status,
      settlement_mode
    )
    VALUES (
      'itest-channel-other',
      'other-channel',
      '第二渠道',
      'API',
      'ACTIVE',
      'PREPAID'
    )
    ON CONFLICT (channel_code) DO NOTHING
  `;
  await db`
    INSERT INTO channel.channel_api_credentials (
      id,
      channel_id,
      access_key,
      secret_key_encrypted,
      sign_algorithm,
      status
    )
    VALUES (
      'itest-channel-credential-other',
      'itest-channel-other',
      'other-access-key',
      ${secret},
      'HMAC_SHA256',
      'ACTIVE'
    )
    ON CONFLICT (access_key) DO NOTHING
  `;
}

async function findSupplierOrder(orderNo: string) {
  return db<
    {
      supplierId: string;
      supplierOrderNo: string;
      standardStatus: string;
    }[]
  >`
    SELECT
      supplier_id AS "supplierId",
      supplier_order_no AS "supplierOrderNo",
      standard_status AS "standardStatus"
    FROM supplier.supplier_orders
    WHERE order_no = ${orderNo}
    LIMIT 1
  `;
}

async function listSupplierQueryJobs(orderNo: string) {
  return db<
    {
      businessKey: string;
      nextRunAt: string | null;
    }[]
  >`
    SELECT
      business_key AS "businessKey",
      next_run_at::text AS "nextRunAt"
    FROM worker.worker_jobs
    WHERE job_type = 'supplier.query'
      AND business_key LIKE ${`${orderNo}:query:%`}
    ORDER BY business_key ASC
  `;
}

async function setMockSupplierMode(mode: 'mock-auto-success' | 'mock-auto-fail') {
  await db`
    UPDATE supplier.supplier_configs
    SET
      config_json = ${JSON.stringify({ mode })},
      updated_at = NOW()
    WHERE supplier_id = 'seed-supplier-mock'
  `;
}

const ITEST_SHENZHEN_KEFEI_SUPPLIER_ID = 'itest-supplier-shenzhen-kefei';
const ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE = 'itest-shenzhen-kefei';
const seedGuangdongMixed50 = {
  productId: buildSeedRechargeProductId({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  }),
  productCode: buildSeedRechargeProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  }),
  mockSupplierProductCode: buildSeedMockSupplierProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  }),
};

async function seedShenzhenKefeiSupplier() {
  await db`
    INSERT INTO supplier.suppliers (
      id,
      supplier_code,
      supplier_name,
      protocol_type,
      status
    )
    VALUES (
      ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID},
      ${ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE},
      '深圳科飞',
      'SOHAN_API',
      'ACTIVE'
    )
    ON CONFLICT (supplier_code) DO UPDATE
    SET
      supplier_name = EXCLUDED.supplier_name,
      protocol_type = EXCLUDED.protocol_type,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
}

async function countShenzhenKefeiPrimaryMappings() {
  const rows = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM product.product_supplier_mappings
    WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
  `;

  return Number(rows[0]?.count ?? 0);
}

async function cleanupShenzhenKefeiPrimaryMapping() {
  await db`
    DELETE FROM product.product_supplier_mappings
    WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
  `;

  await db`
    DELETE FROM supplier.supplier_configs
    WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
  `;

  await db`
    DELETE FROM supplier.suppliers
    WHERE id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
       OR supplier_code = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE}
  `;
}

async function getLatestSupplierCallbackLog(supplierOrderNo: string) {
  const rows = await db<
    {
      signatureValid: boolean;
      parsedStatus: string | null;
      headersJson: Record<string, unknown> | string;
    }[]
  >`
    SELECT
      signature_valid AS "signatureValid",
      parsed_status AS "parsedStatus",
      headers_json AS "headersJson"
    FROM supplier.supplier_callback_logs
    WHERE supplier_order_no = ${supplierOrderNo}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function resetTestStateV1() {
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
  await seedSecondChannel();
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

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  await runSeed(db);
  await seedSecondChannel();
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestStateV1();
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe.serial('V1 ISP 充值下单链路', () => {
  test('开放接口使用 mobile + faceValue + product_type 创建订单并走余额扣款', async () => {
    const body = {
      channelOrderNo: `itest-v1-${Date.now()}`,
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

    expect(response.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();
    expect(json.data.matchedProductId).toBeTruthy();
    expect(json.data.mainStatus).toBe('CREATED');

    const orderNo = String(json.data.orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const storedRows = await getStoredOrderState(orderNo);
    const storedOrder = storedRows[0];

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(ledgerEntries.every((entry) => Number(entry.amount) > 0)).toBe(true);
    expect(ledgerEntries.every((entry) => entry.referenceNo)).toBe(true);
    expect(storedOrder).toMatchObject({
      refundStatus: 'NONE',
      monitorStatus: 'NORMAL',
      requestedProductType: 'MIXED',
    });
    expect(storedOrder?.warningDeadlineAt).toBeTruthy();
    expect(storedOrder?.expireDeadlineAt).toBeTruthy();
    expect(storedOrder?.channelSnapshotJson).toBeTruthy();
    expect(storedOrder?.productSnapshotJson).toBeTruthy();
    expect(storedOrder?.callbackSnapshotJson).toBeTruthy();
    expect(storedOrder?.supplierRouteSnapshotJson).toBeTruthy();
    expect(storedOrder?.riskSnapshotJson).toBeTruthy();
    expect(normalizeJsonLike(storedOrder?.extJson)).toEqual({});
  });

  test('通过目录同步产生深圳科飞映射后开放下单主链路会选择它', async () => {
    await seedShenzhenKefeiSupplier();

    try {
      const adapter = new ShenzhenKefeiAdapter({
        baseUrl: 'https://supplier.example.com',
        agentAccount: 'JG18948358181',
        md5Key: 'F29C80BB80EA32D4',
        fetchImpl: (async () =>
          new Response(
            new Uint8Array(
              iconv.encode(
                JSON.stringify({
                  errorCode: 1,
                  dataset: [
                    {
                      itemId: 'kefei-cmcc-mixed-50',
                      itemName: '广东移动 50 元',
                      ispName: 'CMCC',
                      province: '广东',
                      parValue: 50,
                      inPrice: 48.5,
                      stock: 100,
                      salesStatus: 'ON_SALE',
                    },
                  ],
                }),
                'gbk',
              ),
            ),
          )) as unknown as typeof fetch,
      });
      const catalog = await adapter.syncCatalog();
      const syncResult = await runtime.services.suppliers.syncFullCatalog({
        supplierCode: ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE,
        items: catalog.items,
      });
      const body = {
        channelOrderNo: `itest-kefei-priority-${Date.now()}`,
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
      const storedRows = await getStoredOrderState(orderNo);
      const routeSnapshot = normalizeJsonLike(storedRows[0]?.supplierRouteSnapshotJson);
      const kefeiRows = await db<{ priority: number }[]>`
        SELECT priority
        FROM product.product_supplier_mappings
        WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
          AND supplier_product_code = 'kefei-cmcc-mixed-50'
        LIMIT 1
      `;
      const supplierCandidates = Array.isArray(routeSnapshot.supplierCandidates)
        ? (routeSnapshot.supplierCandidates as Array<Record<string, unknown>>)
        : [];

      expect(response.status).toBe(200);
      expect(json.code).toBe(0);
      expect(syncResult).toEqual({
        syncedProducts: [seedGuangdongMixed50.productCode],
      });
      expect(kefeiRows[0]?.priority).toBe(0);
      expect(json.data.matchedProductId).toBe(seedGuangdongMixed50.productId);
      expect(supplierCandidates[0]).toMatchObject({
        supplierId: ITEST_SHENZHEN_KEFEI_SUPPLIER_ID,
        supplierProductCode: 'kefei-cmcc-mixed-50',
        priority: 0,
      });
      expect(
        supplierCandidates.some(
          (candidate) =>
            candidate.supplierId === 'seed-supplier-mock' &&
            candidate.supplierProductCode === seedGuangdongMixed50.mockSupplierProductCode,
        ),
      ).toBe(true);
    } finally {
      await cleanupShenzhenKefeiPrimaryMapping();
    }
  });

  test('开放接口订单查询不会暴露内部敏感字段', async () => {
    expect(await countShenzhenKefeiPrimaryMappings()).toBe(0);

    const body = {
      channelOrderNo: `itest-open-dto-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
      ext: {
        clientMemo: 'visible-to-channel',
      },
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);

    const getOrderResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}`,
          method: 'GET',
        }),
      }),
    );
    const getOrderJson = await readResponseJson(getOrderResponse);
    const getEventsResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}/events`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}/events`,
          method: 'GET',
        }),
      }),
    );
    const getEventsJson = await readResponseJson(getEventsResponse);

    expect(createResponse.status).toBe(200);
    expect(getOrderResponse.status).toBe(200);
    expect(getEventsResponse.status).toBe(200);

    expect(createJson.data.purchasePrice).toBeUndefined();
    expect(createJson.data.supplierRouteSnapshotJson).toBeUndefined();
    expect(createJson.data.riskSnapshotJson).toBeUndefined();
    expect(createJson.data.callbackSnapshotJson).toBeUndefined();
    expect(createJson.data.channelSnapshotJson).toBeUndefined();
    expect(createJson.data.requestId).toBeUndefined();
    expect(createJson.data.version).toBeUndefined();
    expect(createJson.data.extJson).toEqual({
      clientMemo: 'visible-to-channel',
    });

    expect(getOrderJson.data.purchasePrice).toBeUndefined();
    expect(getOrderJson.data.supplierRouteSnapshotJson).toBeUndefined();
    expect(getOrderJson.data.riskSnapshotJson).toBeUndefined();
    expect(getOrderJson.data.callbackSnapshotJson).toBeUndefined();
    expect(getOrderJson.data.channelSnapshotJson).toBeUndefined();
    expect(getOrderJson.data.requestId).toBeUndefined();
    expect(getOrderJson.data.version).toBeUndefined();
    expect(getOrderJson.data.extJson).toEqual({
      clientMemo: 'visible-to-channel',
    });

    expect(Array.isArray(getEventsJson.data)).toBe(true);
    const events = Array.isArray(getEventsJson.data) ? getEventsJson.data : [];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events as Array<Record<string, unknown>>) {
      expect(event.requestId).toBeUndefined();
      expect(event.operator).toBeUndefined();
      expect(event.sourceService).toBeUndefined();
      expect(event.idempotencyKey).toBeUndefined();
      expect(event.payloadJson).toBeUndefined();
    }
  });

  test('创建订单后处理 supplier.submit 不会因缺少供应商订单表而失败', async () => {
    const body = {
      channelOrderNo: `itest-worker-${Date.now()}`,
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

    const supplierOrders = await findSupplierOrder(orderNo);
    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expect(supplierOrders).toHaveLength(1);
    expect(supplierOrders[0]).toMatchObject({
      standardStatus: 'ACCEPTED',
    });
    expect(order.mainStatus).toBe('PROCESSING');
    expect(order.supplierStatus).toBe('ACCEPTED');
  });

  test('FAST 订单会按预设时间点创建多条 supplier.query 调度任务', async () => {
    const body = {
      channelOrderNo: `itest-query-cadence-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 100,
      product_type: 'FAST',
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

    const queryJobs = await listSupplierQueryJobs(orderNo);

    expect(queryJobs).toHaveLength(8);
    expect(queryJobs[0]?.businessKey).toBe(`${orderNo}:query:0`);
    expect(queryJobs[7]?.businessKey).toBe(`${orderNo}:query:7`);
    expect(queryJobs.every((job) => job.nextRunAt)).toBe(true);
  });

  test('完整成功链路会进入 SUCCESS 并完成通知', async () => {
    const body = {
      channelOrderNo: `itest-success-${Date.now()}`,
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

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);

    expect(order.mainStatus).toBe('SUCCESS');
    expect(order.supplierStatus).toBe('SUCCESS');
    expect(order.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_PROFIT');
  });

  test('有效供应商回调会被验签接受并推进成功状态', async () => {
    const body = {
      channelOrderNo: `itest-supplier-callback-success-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);

    await processWorkerRound();

    const supplierOrders = await findSupplierOrder(orderNo);
    const supplierOrderNo = supplierOrders[0]?.supplierOrderNo;
    const callbackBody = {
      supplierOrderNo: String(supplierOrderNo),
      status: 'SUCCESS',
    } as const;

    expect(supplierOrderNo).toBeTruthy();

    const callbackResponse = await runtime.app.handle(
      new Request('http://localhost/callbacks/suppliers/mock-supplier', {
        method: 'POST',
        headers: buildSupplierCallbackHeaders({
          body: callbackBody,
        }),
        body: JSON.stringify(callbackBody),
      }),
    );
    const callbackJson = await readResponseJson(callbackResponse);
    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const callbackLog = await getLatestSupplierCallbackLog(String(supplierOrderNo));
    const callbackHeaders = normalizeJsonLike(callbackLog?.headersJson);

    expect(callbackResponse.status).toBe(200);
    expect(callbackJson.code).toBe(0);
    expect(order.mainStatus).toBe('SUCCESS');
    expect(order.supplierStatus).toBe('SUCCESS');
    expect(callbackLog).toMatchObject({
      signatureValid: true,
      parsedStatus: 'SUCCESS',
    });
    expect(callbackHeaders).toMatchObject({
      sign: signOpenApiPayload('mock-supplier-callback', stableStringify(callbackBody)),
    });
  });

  test('无效供应商回调签名会被拒绝且仅记录为无效日志', async () => {
    const body = {
      channelOrderNo: `itest-supplier-callback-invalid-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);

    await processWorkerRound();

    const supplierOrders = await findSupplierOrder(orderNo);
    const supplierOrderNo = supplierOrders[0]?.supplierOrderNo;
    const callbackBody = {
      supplierOrderNo: String(supplierOrderNo),
      status: 'FAIL',
      reason: 'forged',
    } as const;

    expect(supplierOrderNo).toBeTruthy();

    const callbackResponse = await runtime.app.handle(
      new Request('http://localhost/callbacks/suppliers/mock-supplier', {
        method: 'POST',
        headers: buildSupplierCallbackHeaders({
          body: callbackBody,
          signature: 'bad-signature',
        }),
        body: JSON.stringify(callbackBody),
      }),
    );
    const callbackText = await callbackResponse.text();
    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const refreshedSupplierOrders = await findSupplierOrder(orderNo);
    const callbackLog = await getLatestSupplierCallbackLog(String(supplierOrderNo));
    const callbackHeaders = normalizeJsonLike(callbackLog?.headersJson);

    expect(callbackResponse.status).toBe(401);
    expect(callbackText).toContain('签名');
    expect(order.mainStatus).toBe('PROCESSING');
    expect(order.supplierStatus).toBe('ACCEPTED');
    expect(refreshedSupplierOrders[0]?.standardStatus).toBe('ACCEPTED');
    expect(callbackLog).toMatchObject({
      signatureValid: false,
      parsedStatus: 'FAIL',
    });
    expect(callbackHeaders).toMatchObject({
      sign: 'bad-signature',
    });
  });

  test('供应商失败后会退款并进入 REFUNDED', async () => {
    await setMockSupplierMode('mock-auto-fail');

    const body = {
      channelOrderNo: `itest-refund-${Date.now()}`,
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

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);

    expect(order.mainStatus).toBe('REFUNDED');
    expect(order.refundStatus).toBe('SUCCESS');
    expect(order.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
  });

  test('手工关闭非成功订单会退款并进入 REFUNDED', async () => {
    const body = {
      channelOrderNo: `itest-close-refund-${Date.now()}`,
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
    await runtime.services.orders.closeOrder(orderNo, 'req-close-order');

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const eventTypes = await getOrderEventTypes(orderNo);

    expect(order.mainStatus).toBe('REFUNDED');
    expect(order.refundStatus).toBe('SUCCESS');
    expect(order.supplierStatus).toBe('FAIL');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
    expect(eventTypes.map((event) => event.eventType)).toContain('OrderClosed');
    expect(eventTypes.map((event) => event.eventType)).toContain('RefundSucceeded');
  });

  test('已退款订单收到供应商成功会标记 LATE_CALLBACK_EXCEPTION', async () => {
    await setMockSupplierMode('mock-auto-fail');

    const body = {
      channelOrderNo: `itest-late-success-${Date.now()}`,
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

    const supplierOrders = await findSupplierOrder(orderNo);
    const supplierOrderNo = String(supplierOrders[0]?.supplierOrderNo);

    await runtime.services.orders.handleSupplierSucceeded({
      orderNo,
      supplierId: String(supplierOrders[0]?.supplierId),
      supplierOrderNo,
      costPrice: 45,
    });

    const order = await runtime.services.orders.getOrderByNo(orderNo);
    const eventTypes = await getOrderEventTypes(orderNo);

    expect(order.mainStatus).toBe('REFUNDED');
    expect(order.refundStatus).toBe('SUCCESS');
    expect(order.monitorStatus).toBe('LATE_CALLBACK_EXCEPTION');
    expect(order.exceptionTag).toBe('LATE_CALLBACK_EXCEPTION');
    expect(eventTypes.map((event) => event.eventType)).toContain('SupplierLateSuccessAfterRefund');
  });

  test('余额不足时不会留下脏订单，补足余额后可用同渠道单号重试', async () => {
    const channelId = await getDemoChannelId();
    const channelOrderNo = `itest-balance-${Date.now()}`;

    expect(channelId).toBeTruthy();

    await setChannelBalance(String(channelId), 0);

    const body = {
      channelOrderNo,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const firstResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const firstText = await firstResponse.text();
    const firstLookup = await getOrderByChannelOrder(String(channelId), channelOrderNo);

    expect(firstResponse.status).toBe(400);
    expect(firstText).toContain('渠道余额不足');
    expect(firstLookup).toHaveLength(0);

    await setChannelBalance(String(channelId), 10000);

    const secondResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const secondJson = await readResponseJson(secondResponse);

    expect(secondResponse.status).toBe(200);
    expect(secondJson.code).toBe(0);
    expect(secondJson.data.orderNo).toBeTruthy();
  });

  test('开放接口订单读取会限制在认证渠道内', async () => {
    const body = {
      channelOrderNo: `itest-scope-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);

    const getOrderResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}`,
          method: 'GET',
          accessKey: 'other-access-key',
          secretKey: 'other-secret-key',
        }),
      }),
    );
    const getEventsResponse = await runtime.app.handle(
      new Request(`http://localhost/open-api/orders/${orderNo}/events`, {
        method: 'GET',
        headers: buildSignedHeaders({
          path: `/open-api/orders/${orderNo}/events`,
          method: 'GET',
          accessKey: 'other-access-key',
          secretKey: 'other-secret-key',
        }),
      }),
    );

    expect(getOrderResponse.status).toBe(404);
    expect(getEventsResponse.status).toBe(404);
  });

  test('并发状态推进不会覆盖彼此不相关的字段', async () => {
    const body = {
      channelOrderNo: `itest-concurrency-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
    };

    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders',
          body,
        }),
        body: JSON.stringify(body),
      }),
    );
    const createJson = await readResponseJson(createResponse);
    const orderNo = String(createJson.data.orderNo);
    const repository = new OrdersRepository();

    let releaseLock!: () => void;
    let lockReady!: () => void;

    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockAcquired = new Promise<void>((resolve) => {
      lockReady = resolve;
    });

    const heldLock = db.begin(async (tx) => {
      await tx`
        SELECT id
        FROM ordering.orders
        WHERE order_no = ${orderNo}
        FOR UPDATE
      `;
      lockReady();
      await lockPromise;
    });

    await lockAcquired;

    const supplierUpdate = repository.updateStatuses(orderNo, {
      supplierStatus: 'ACCEPTED',
      mainStatus: 'PROCESSING',
    });
    const notifyUpdate = repository.updateStatuses(orderNo, {
      notifyStatus: 'SUCCESS',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseLock();

    await Promise.all([heldLock, supplierUpdate, notifyUpdate]);

    const order = await runtime.services.orders.getOrderByNo(orderNo);

    expect(order.mainStatus).toBe('PROCESSING');
    expect(order.supplierStatus).toBe('ACCEPTED');
    expect(order.notifyStatus).toBe('SUCCESS');
  });
});
