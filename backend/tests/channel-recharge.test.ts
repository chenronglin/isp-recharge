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

function buildSignedHeaders(input: {
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  accessKey: string;
  secretKey: string;
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
    AccessKey: input.accessKey,
    Sign: signOpenApiPayload(input.secretKey, canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function createChannel(adminToken: string) {
  const response = await runtime.app.handle(
    new Request('http://localhost/admin/channels', {
      method: 'POST',
      headers: {
        authorization: adminToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        channelCode: `manual-channel-${Date.now()}`,
        channelName: '手工联调渠道',
        channelType: 'API',
      }),
    }),
  );

  return response.json() as Promise<{
    code: number;
    data: {
      resourceId: string;
      status: string;
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

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe('后台渠道充值', () => {
  test('首次充值会自动初始化渠道余额账户并写入充值流水', async () => {
    const adminToken = await buildAdminAuthorizationHeader();
    const channelPayload = await createChannel(adminToken);
    const channelId = channelPayload.data.resourceId;

    const response = await runtime.app.handle(
      new Request(`http://localhost/admin/channels/${channelId}/recharge`, {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
          'x-request-id': 'manual-recharge-request-1',
        },
        body: JSON.stringify({
          amount: 500,
          remark: '联调充值',
        }),
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        resourceId: string;
        resourceType: string;
        status: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toMatchObject({
      resourceId: channelId,
      resourceType: 'CHANNEL_ACCOUNT',
      status: 'RECHARGED',
    });

    const accountRows = await db<
      {
        availableBalance: string;
        frozenBalance: string;
        status: string;
      }[]
    >`
      SELECT
        available_balance::text AS "availableBalance",
        frozen_balance::text AS "frozenBalance",
        status
      FROM ledger.accounts
      WHERE owner_type = 'CHANNEL'
        AND owner_id = ${channelId}
      LIMIT 1
    `;

    expect(accountRows[0]).toMatchObject({
      availableBalance: '500.00',
      frozenBalance: '0.00',
      status: 'ACTIVE',
    });

    const ledgerRows = await db<
      {
        actionType: string;
        direction: string;
        amount: string;
        referenceType: string;
        referenceNo: string;
        orderNo: string | null;
      }[]
    >`
      SELECT
        action_type AS "actionType",
        direction,
        amount::text AS amount,
        reference_type AS "referenceType",
        reference_no AS "referenceNo",
        order_no AS "orderNo"
      FROM ledger.account_ledgers
      WHERE reference_type = 'CHANNEL_RECHARGE'
        AND reference_no = 'manual-recharge-request-1'
      LIMIT 1
    `;

    expect(ledgerRows[0]).toMatchObject({
      actionType: 'CHANNEL_RECHARGE',
      direction: 'CREDIT',
      amount: '500.00',
      referenceType: 'CHANNEL_RECHARGE',
      referenceNo: 'manual-recharge-request-1',
      orderNo: null,
    });
  });

  test('新建渠道充值后可直接通过 open-api 创建订单', async () => {
    const adminToken = await buildAdminAuthorizationHeader();
    const channelPayload = await createChannel(adminToken);
    const channelId = channelPayload.data.resourceId;
    const accessKey = `ak-${Date.now()}`;
    const secretKey = `sk-${Date.now()}-manual`;
    const productId = buildSeedRechargeProductId({
      carrierCode: 'CMCC',
      provinceName: '广东',
      productType: 'MIXED',
      faceValue: 50,
    });

    await runtime.app.handle(
      new Request('http://localhost/admin/channel-api-keys', {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          accessKey,
          secretKey,
        }),
      }),
    );

    await runtime.app.handle(
      new Request('http://localhost/admin/channel-products', {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          productId,
        }),
      }),
    );

    await runtime.app.handle(
      new Request('http://localhost/admin/channel-prices', {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          productId,
          salePrice: 50,
        }),
      }),
    );

    await runtime.app.handle(
      new Request('http://localhost/admin/channel-callback-configs', {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          callbackUrl: 'mock://success',
          signSecret: 'manual-callback-secret',
          timeoutSeconds: 5,
        }),
      }),
    );

    const rechargeResponse = await runtime.app.handle(
      new Request(`http://localhost/admin/channels/${channelId}/recharge`, {
        method: 'POST',
        headers: {
          authorization: adminToken,
          'content-type': 'application/json',
          'x-request-id': 'manual-recharge-request-2',
        },
        body: JSON.stringify({
          amount: 500,
          remark: '联调充值',
        }),
      }),
    );

    expect(rechargeResponse.status).toBe(200);

    const orderBody = {
      channelOrderNo: `manual-order-${Date.now()}`,
      mobile: '13800130000',
      faceValue: 50,
      product_type: 'MIXED',
      ext: {
        source: 'manual-recharge-test',
      },
    };

    const orderResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/orders/', {
        method: 'POST',
        headers: buildSignedHeaders({
          path: '/open-api/orders/',
          body: orderBody,
          accessKey,
          secretKey,
        }),
        body: JSON.stringify(orderBody),
      }),
    );
    const orderPayload = (await orderResponse.json()) as {
      code: number;
      data: {
        orderNo: string;
        salePrice: number;
      };
    };

    expect(orderResponse.status).toBe(200);
    expect(orderPayload.code).toBe(0);
    expect(orderPayload.data.orderNo).toBeTruthy();
    expect(orderPayload.data.salePrice).toBe(50);

    const accountRows = await db<{ availableBalance: string }[]>`
      SELECT available_balance::text AS "availableBalance"
      FROM ledger.accounts
      WHERE owner_type = 'CHANNEL'
        AND owner_id = ${channelId}
      LIMIT 1
    `;

    expect(accountRows[0]?.availableBalance).toBe('450.00');
  });
});
