import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import {
  acquireIntegrationTestLock,
  forceWorkerJobsReady,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

function buildSignedHeaders(path: string, body: Record<string, unknown>) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const bodyText = stableStringify(body);
  const canonical = buildOpenApiCanonicalString({
    method: 'POST',
    path,
    timestamp,
    nonce,
    body: bodyText,
  });

  return {
    'content-type': 'application/json',
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function readResponseJson(response: Response) {
  return response.json() as Promise<{
    code: number;
    message: string;
    data: Record<string, any>;
    requestId: string;
  }>;
}

async function getOrderLedgerEntries(orderNo: string) {
  return db<
    {
      actionType: string;
      direction: string;
      referenceNo: string;
    }[]
  >`
    SELECT
      action_type AS "actionType",
      direction,
      reference_no AS "referenceNo"
    FROM ledger.account_ledgers
    WHERE order_no = ${orderNo}
    ORDER BY created_at ASC, id ASC
  `;
}

async function getOrderEventSources(orderNo: string, eventType: string) {
  return db<
    {
      sourceService: string;
      sourceNo: string | null;
    }[]
  >`
    SELECT
      source_service AS "sourceService",
      source_no AS "sourceNo"
    FROM ordering.order_events
    WHERE order_no = ${orderNo}
      AND event_type = ${eventType}
    ORDER BY occurred_at ASC, id ASC
  `;
}

async function getDemoChannelId() {
  const rows = await db<{ id: string }[]>`
    SELECT c.id
    FROM channel.channels c
    INNER JOIN channel.channel_api_credentials cred
      ON cred.channel_id = c.id
    WHERE cred.access_key = 'demo-access-key'
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

async function findOrderByChannelOrder(channelId: string, channelOrderNo: string) {
  const rows = await db<
    {
      orderNo: string;
      mainStatus: string;
      paymentStatus: string;
    }[]
  >`
    SELECT
      order_no AS "orderNo",
      main_status AS "mainStatus",
      payment_status AS "paymentStatus"
    FROM ordering.orders
    WHERE channel_id = ${channelId}
      AND channel_order_no = ${channelOrderNo}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function processWorkerRound() {
  await forceWorkerJobsReady();
  await runtime.services.worker.processReadyJobs();
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
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

describe.skip('主交易链路（旧 sku/payment 模型，已由 order-flow-v1 覆盖）', () => {
  test('余额支付订单会先落账，再完成履约并成功通知', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const body = {
      channelOrderNo: `itest-${Date.now()}`,
      skuId,
      paymentMode: 'BALANCE',
    };
    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();

    const orderNo = String(json.data.orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const paymentEvents = await getOrderEventSources(orderNo, 'PaymentSucceeded');

    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries.map((entry) => entry.actionType)).toEqual([
      'BALANCE_PAYMENT',
      'BALANCE_PAYMENT',
    ]);
    expect(ledgerEntries.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
    expect(paymentEvents).toHaveLength(1);
    expect(paymentEvents[0]).toMatchObject({
      sourceService: 'ledger',
    });
    expect(paymentEvents[0]?.sourceNo).toBeTruthy();

    // 第一次执行会提交供应商并进入受理状态。
    await processWorkerRound();
    // 第二次执行会执行供应商查询并推进订单成功。
    await processWorkerRound();
    // 第三次执行处理通知任务。
    await processWorkerRound();

    const finalOrder = await runtime.services.orders.getOrderByNo(orderNo);

    expect(finalOrder.mainStatus).toBe('SUCCESS');
    expect(finalOrder.paymentStatus).toBe('PAID');
    expect(finalOrder.supplierStatus).toBe('SUCCESS');
    expect(finalOrder.notifyStatus).toBe('SUCCESS');
  });

  test('余额支付订单在供应商失败后会执行退款落账并进入已退款状态', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const body = {
      channelOrderNo: `refund-${Date.now()}`,
      skuId,
      paymentMode: 'BALANCE',
      ext: {
        scenario: 'SUPPLIER_FAIL',
      },
    };
    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const json = await readResponseJson(response);

    expect(json.code).toBe(0);
    expect(json.data.orderNo).toBeTruthy();

    const orderNo = String(json.data.orderNo);
    await processWorkerRound();
    await processWorkerRound();
    await processWorkerRound();

    const finalOrder = await runtime.services.orders.getOrderByNo(orderNo);
    const ledgerEntries = await getOrderLedgerEntries(orderNo);
    const refundEvents = await getOrderEventSources(orderNo, 'RefundSucceeded');

    expect(finalOrder.mainStatus).toBe('REFUNDED');
    expect(finalOrder.notifyStatus).toBe('SUCCESS');
    expect(ledgerEntries.map((entry) => entry.actionType)).toContain('ORDER_REFUND');
    expect(refundEvents).toHaveLength(1);
    expect(refundEvents[0]).toMatchObject({
      sourceService: 'ledger',
    });
  });

  test('余额不足导致首次资金扣减失败时不会留下脏订单，补足余额后可用同渠道单号重试成功', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;
    const channelId = await getDemoChannelId();

    expect(skuId).toBeTruthy();
    expect(channelId).toBeTruthy();

    const channelOrderNo = `insufficient-${Date.now()}`;
    const body = {
      channelOrderNo,
      skuId,
      paymentMode: 'BALANCE',
    };

    await setChannelBalance(String(channelId), 0);

    const firstResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );

    expect(firstResponse.status).toBe(500);
    expect(await findOrderByChannelOrder(String(channelId), channelOrderNo)).toBeNull();

    await setChannelBalance(String(channelId), 10000);

    const retryResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', body),
        body: JSON.stringify(body),
      }),
    );
    const retryJson = await readResponseJson(retryResponse);

    expect(retryResponse.status).toBe(200);
    expect(retryJson.code).toBe(0);
    expect(retryJson.data.orderNo).toBeTruthy();
    expect(await findOrderByChannelOrder(String(channelId), channelOrderNo)).toMatchObject({
      orderNo: String(retryJson.data.orderNo),
      mainStatus: 'WAIT_SUPPLIER_SUBMIT',
      paymentStatus: 'PAID',
    });
  });

  test('在线支付模式不再属于新基础设施', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const createBody = {
      channelOrderNo: `online-${Date.now()}`,
      skuId,
      paymentMode: 'ONLINE',
    };
    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', createBody),
        body: JSON.stringify(createBody),
      }),
    );

    expect(createResponse.status).toBe(422);

    const legacyResponse = await runtime.app.handle(
      new Request('http://localhost/internal/orders/demo-order/payment-events', {
        method: 'POST',
      }),
    );

    expect(legacyResponse.status).toBe(404);
  });

  test('免费订单模式不再属于新基础设施', async () => {
    const skuRows = await db.unsafe<{ id: string }[]>(
      'SELECT id FROM product.product_skus ORDER BY created_at ASC LIMIT 1',
    );
    const skuId = skuRows[0]?.id;

    expect(skuId).toBeTruthy();

    const createBody = {
      channelOrderNo: `free-${Date.now()}`,
      skuId,
      paymentMode: 'FREE',
    };
    const createResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders', {
        method: 'POST',
        headers: buildSignedHeaders('/open-api/orders', createBody),
        body: JSON.stringify(createBody),
      }),
    );

    expect(createResponse.status).toBe(422);
  });

  test('初始化 migration 不再包含 payment bootstrap 残留', async () => {
    const migrationText = await Bun.file(
      '/Users/moses/Developer/Docs/.worktrees/isp-recharge-v1/backend/src/database/migrations/0001_init_schemas.sql',
    ).text();

    expect(migrationText.includes('CREATE SCHEMA IF NOT EXISTS payment')).toBe(false);
    expect(migrationText.includes('payment.')).toBe(false);
    expect(migrationText.includes('idx_payment')).toBe(false);
  });
});
