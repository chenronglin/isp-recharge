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
const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

function buildSignedHeaders(input: {
  path: string;
  body?: Record<string, unknown>;
  method?: string;
  nonce?: string;
  timestamp?: string;
}) {
  const method = input.method ?? 'POST';
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? `nonce-${Date.now()}-${Math.random()}`;
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

async function getDemoChannelId() {
  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM channel.channels
    WHERE channel_code = 'demo-channel'
    LIMIT 1
  `;

  return rows[0]?.id ?? null;
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
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

test('重复使用同一个 nonce 会被拒绝', async () => {
  const timestamp = String(Date.now());
  const nonce = `replay-nonce-${Date.now()}`;
  const headers = buildSignedHeaders({
    path: '/open-api/channel/profile',
    method: 'GET',
    body: {},
    nonce,
    timestamp,
  });

  const firstResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/channel/profile', {
      method: 'GET',
      headers,
    }),
  );
  const secondResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/channel/profile', {
      method: 'GET',
      headers,
    }),
  );
  const secondText = await secondResponse.text();

  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(401);
  expect(secondText).toContain('Nonce 已被使用');
});

test('超过日限额的第二笔订单会被拒绝', async () => {
  const channelId = await getDemoChannelId();

  expect(channelId).toBeTruthy();

  await runtime.services.channels.upsertLimitRule({
    channelId: String(channelId),
    singleLimit: 1000,
    dailyLimit: 60,
    monthlyLimit: 1000000,
    qpsLimit: 100,
  });

  const firstBody = {
    channelOrderNo: `daily-limit-1-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
  };
  const secondBody = {
    channelOrderNo: `daily-limit-2-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
  };

  const firstResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/orders', {
      method: 'POST',
      headers: buildSignedHeaders({
        path: '/open-api/orders',
        body: firstBody,
      }),
      body: JSON.stringify(firstBody),
    }),
  );
  const secondResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/orders', {
      method: 'POST',
      headers: buildSignedHeaders({
        path: '/open-api/orders',
        body: secondBody,
      }),
      body: JSON.stringify(secondBody),
    }),
  );
  const secondText = await secondResponse.text();

  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(403);
  expect(secondText).toContain('订单金额超出日限额');
});

test('超过 QPS 限额的连续请求会被拒绝', async () => {
  const channelId = await getDemoChannelId();

  expect(channelId).toBeTruthy();

  await runtime.services.channels.upsertLimitRule({
    channelId: String(channelId),
    singleLimit: 1000,
    dailyLimit: 1000000,
    monthlyLimit: 1000000,
    qpsLimit: 1,
  });

  const firstBody = {
    channelOrderNo: `qps-limit-1-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
  };
  const secondBody = {
    channelOrderNo: `qps-limit-2-${Date.now()}`,
    mobile: '13800130000',
    faceValue: 50,
    product_type: 'MIXED',
  };

  const firstResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/orders', {
      method: 'POST',
      headers: buildSignedHeaders({
        path: '/open-api/orders',
        body: firstBody,
      }),
      body: JSON.stringify(firstBody),
    }),
  );
  const secondResponse = await runtime.app.handle(
    new Request('http://localhost/open-api/orders', {
      method: 'POST',
      headers: buildSignedHeaders({
        path: '/open-api/orders',
        body: secondBody,
      }),
      body: JSON.stringify(secondBody),
    }),
  );
  const secondText = await secondResponse.text();

  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(403);
  expect(secondText).toContain('渠道请求频率超限');
});

test('渠道销售价低于采购价时会拒绝下单', async () => {
  const channelId = await getDemoChannelId();

  expect(channelId).toBeTruthy();

  await runtime.services.channels.upsertPricePolicy({
    channelId: String(channelId),
    productId: 'seed-product-cmcc-mixed-50',
    salePrice: 40,
  });

  const body = {
    channelOrderNo: `price-floor-${Date.now()}`,
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
  const text = await response.text();

  expect(response.status).toBe(400);
  expect(text).toContain('渠道销售价不得低于采购价');
});
