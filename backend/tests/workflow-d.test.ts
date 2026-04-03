import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { buildSeedRechargeProductId } from '@/database/seeds/0001_base.seed';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { stableStringify } from '@/lib/utils';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

async function buildAdminAuthorizationHeader() {
  const token = await signJwt(
    {
      sub: 'seed-admin-user',
      type: 'admin',
      roleIds: ['SUPER_ADMIN'],
      scope: 'admin',
      jti: `itest-admin-${Date.now()}`,
    },
    env.adminJwtSecret,
    900,
  );

  return `Bearer ${token}`;
}

async function buildInternalAuthorizationHeader() {
  const token = await signJwt(
    {
      sub: 'itest-internal-service',
      type: 'internal',
      roleIds: [],
      scope: 'internal',
      jti: `itest-internal-${Date.now()}`,
    },
    env.internalJwtSecret,
    900,
  );

  return `Bearer ${token}`;
}

function buildSignedOpenApiHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
}) {
  const method = input.method ?? 'POST';
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}-${Math.random()}`;
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
    AccessKey: env.seed.accessKey,
    Sign: signOpenApiPayload(env.seed.secretKey, canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function insertOrder(input: {
  orderNo: string;
  channelOrderNo: string;
  mobile: string;
  mainStatus?: string;
  supplierStatus?: string;
  notifyStatus?: string;
}) {
  const productId = buildSeedRechargeProductId({
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
      ${`itest-order-${input.orderNo}`},
      ${input.orderNo},
      ${input.channelOrderNo},
      'seed-channel-demo',
      ${productId},
      ${input.mobile},
      '广东',
      'CMCC',
      50,
      48,
      45,
      ${input.mainStatus ?? 'CREATED'},
      'PAID',
      ${input.supplierStatus ?? 'WAIT_SUBMIT'},
      ${input.notifyStatus ?? 'PENDING'},
      'PASS',
      ${`req-${input.orderNo}`},
      NOW(),
      NOW()
    )
  `;
}

async function createOpenOrder(channelOrderNo: string) {
  const response = await runtime.app.handle(
    new Request('http://localhost/open-api/orders', {
      method: 'POST',
      headers: buildSignedOpenApiHeaders({
        path: '/open-api/orders',
        body: {
          channelOrderNo,
          mobile: '13800130000',
          faceValue: 50,
          product_type: 'MIXED',
        },
      }),
      body: JSON.stringify({
        channelOrderNo,
        mobile: '13800130000',
        faceValue: 50,
        product_type: 'MIXED',
      }),
    }),
  );

  return response.json() as Promise<{
    code: number;
    data: {
      orderNo: string;
    };
  }>;
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  runtime = await buildApp({ startWorkerScheduler: false });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(async () => {
  runtime?.stop();
  await releaseIntegrationTestLock();
});

describe('工作流 D 集成验证', () => {
  test('账务流水详情接口返回单笔流水', async () => {
    const adminToken = await buildAdminAuthorizationHeader();
    const recharge = await runtime.services.ledger.rechargeChannelBalance({
      channelId: 'seed-channel-demo',
      amount: 88,
      referenceNo: 'itest-ledger-detail',
    });

    expect(recharge.referenceNo).toBe('itest-ledger-detail');

    const rows = await db<{ id: string }[]>`
      SELECT id
      FROM ledger.account_ledgers
      WHERE reference_no = 'itest-ledger-detail'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const response = await runtime.app.handle(
      new Request(`http://localhost/admin/ledger-entries/${rows[0]?.id}`, {
        headers: {
          authorization: adminToken,
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        id: string;
        referenceNo: string;
        actionType: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toMatchObject({
      id: rows[0]?.id,
      referenceNo: 'itest-ledger-detail',
      actionType: 'CHANNEL_RECHARGE',
    });
  });

  test('后台订单列表支持按订单号、手机号、供应商单号过滤', async () => {
    const adminToken = await buildAdminAuthorizationHeader();
    await insertOrder({
      orderNo: 'order-filter-1',
      channelOrderNo: 'channel-filter-1',
      mobile: '13800130000',
    });
    await insertOrder({
      orderNo: 'order-filter-2',
      channelOrderNo: 'channel-filter-2',
      mobile: '13900139000',
    });
    await db`
      INSERT INTO supplier.supplier_orders (
        id,
        order_no,
        supplier_id,
        supplier_order_no,
        request_payload_json,
        response_payload_json,
        standard_status,
        attempt_no,
        duration_ms,
        created_at,
        updated_at
      )
      VALUES (
        'itest-supplier-order-filter-1',
        'order-filter-1',
        'seed-supplier-mock',
        'supplier-filter-1',
        '{}'::jsonb,
        '{}'::jsonb,
        'ACCEPTED',
        1,
        100,
        NOW(),
        NOW()
      )
    `;

    const byOrderNoResponse = await runtime.app.handle(
      new Request('http://localhost/admin/orders?orderNo=order-filter-1', {
        headers: {
          authorization: adminToken,
        },
      }),
    );
    const byOrderNoPayload = (await byOrderNoResponse.json()) as {
      data: Array<{ orderNo: string }>;
    };

    const byMobileResponse = await runtime.app.handle(
      new Request('http://localhost/admin/orders?mobile=13900139000', {
        headers: {
          authorization: adminToken,
        },
      }),
    );
    const byMobilePayload = (await byMobileResponse.json()) as {
      data: Array<{ orderNo: string }>;
    };

    const bySupplierOrderResponse = await runtime.app.handle(
      new Request('http://localhost/admin/orders?supplierOrderNo=supplier-filter-1', {
        headers: {
          authorization: adminToken,
        },
      }),
    );
    const bySupplierOrderPayload = (await bySupplierOrderResponse.json()) as {
      data: Array<{ orderNo: string }>;
    };

    expect(byOrderNoPayload.data.map((item) => item.orderNo)).toEqual(['order-filter-1']);
    expect(byMobilePayload.data.map((item) => item.orderNo)).toEqual(['order-filter-2']);
    expect(bySupplierOrderPayload.data.map((item) => item.orderNo)).toEqual(['order-filter-1']);
  });

  test('通知任务详情返回任务和最近投递记录', async () => {
    const adminToken = await buildAdminAuthorizationHeader();
    await insertOrder({
      orderNo: 'order-filter-1',
      channelOrderNo: 'channel-notify-detail-1',
      mobile: '13800130000',
      mainStatus: 'SUCCESS',
      supplierStatus: 'SUCCESS',
      notifyStatus: 'RETRYING',
    });

    await db`
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
        'itest-notify-task-detail',
        'notify-detail-1',
        'order-filter-1',
        'seed-channel-demo',
        'WEBHOOK',
        'mock://fail',
        '{"orderNo":"order-filter-1"}'::jsonb,
        'signed',
        'RETRYING',
        2,
        7,
        NOW(),
        NOW()
      )
    `;
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
      VALUES
        (
          'itest-notify-log-1',
          'notify-detail-1',
          '{"attempt":1}'::jsonb,
          '500',
          'fail-1',
          false,
          NOW() - INTERVAL '2 minutes'
        ),
        (
          'itest-notify-log-2',
          'notify-detail-1',
          '{"attempt":2}'::jsonb,
          '200',
          'ok',
          true,
          NOW() - INTERVAL '1 minute'
        )
    `;

    const response = await runtime.app.handle(
      new Request('http://localhost/admin/notifications/tasks/notify-detail-1', {
        headers: {
          authorization: adminToken,
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        task: {
          taskNo: string;
          status: string;
        };
        recentDeliveries: Array<{
          id: string;
          responseStatus: string;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data.task).toMatchObject({
      taskNo: 'notify-detail-1',
      status: 'RETRYING',
    });
    expect(payload.data.recentDeliveries.map((item) => item.id)).toEqual([
      'itest-notify-log-2',
      'itest-notify-log-1',
    ]);
  });

  test('退款失败后会自动创建补偿任务并在后续重试成功', async () => {
    const internalToken = await buildInternalAuthorizationHeader();
    const createOrderPayload = await createOpenOrder(`workflow-d-${Date.now()}`);
    const orderNo = createOrderPayload.data.orderNo;

    await db`
      UPDATE worker.worker_jobs
      SET
        status = 'CANCELED',
        updated_at = NOW()
      WHERE job_type = 'supplier.submit'
        AND business_key = ${orderNo}
    `;

    const originalRefundOrderAmount = runtime.services.ledger.refundOrderAmount.bind(
      runtime.services.ledger,
    );
    let shouldFailOnce = true;

    runtime.services.ledger.refundOrderAmount = async (input) => {
      if (shouldFailOnce) {
        shouldFailOnce = false;
        throw new Error('temporary refund failure');
      }

      return originalRefundOrderAmount(input);
    };

    try {
      const response = await runtime.app.handle(
        new Request(`http://localhost/internal/orders/${orderNo}/supplier-events`, {
          method: 'POST',
          headers: {
            authorization: internalToken,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            status: 'FAIL',
            supplierId: 'seed-supplier-mock',
            supplierOrderNo: `supplier-fail-${orderNo}`,
            reason: '模拟退款补偿',
          }),
        }),
      );

      expect(response.status).toBe(200);

      const pendingOrder = await runtime.services.orders.getOrderByNo(orderNo);
      const scheduledJobs = await db<
        {
          status: string;
          attemptCount: number;
        }[]
      >`
        SELECT
          status,
          attempt_count AS "attemptCount"
        FROM worker.worker_jobs
        WHERE job_type = 'order.refund.retry'
          AND business_key = ${orderNo}
        LIMIT 1
      `;

      expect(pendingOrder.mainStatus).toBe('REFUNDING');
      expect(pendingOrder.refundStatus).toBe('PENDING');
      expect(scheduledJobs[0]).toMatchObject({
        status: 'READY',
        attemptCount: 0,
      });

      await runtime.services.worker.processReadyJobs();

      const refundedOrder = await runtime.services.orders.getOrderByNo(orderNo);
      const refundLedgerRows = await db<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM ledger.account_ledgers
        WHERE order_no = ${orderNo}
          AND action_type = 'ORDER_REFUND'
      `;
      const retryJobRows = await db<{ status: string }[]>`
        SELECT status
        FROM worker.worker_jobs
        WHERE job_type = 'order.refund.retry'
          AND business_key = ${orderNo}
        LIMIT 1
      `;

      expect(refundedOrder.mainStatus).toBe('REFUNDED');
      expect(refundedOrder.refundStatus).toBe('SUCCESS');
      expect(refundLedgerRows[0]?.count).toBe(2);
      expect(retryJobRows[0]?.status).toBe('SUCCESS');
    } finally {
      runtime.services.ledger.refundOrderAmount = originalRefundOrderAmount;
    }
  });
});
