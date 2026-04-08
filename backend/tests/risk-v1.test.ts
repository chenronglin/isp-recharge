import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { db, executeFile } from '@/lib/sql';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;
const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');

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

async function buildAdminAuthorizationHeader() {
  const token = await signJwt(
    {
      sub: 'seed-admin-user',
      type: 'admin',
      roleIds: ['SUPER_ADMIN'],
      scope: 'admin',
      jti: `itest-risk-admin-${Date.now()}`,
    },
    env.adminJwtSecret,
    900,
  );

  return `Bearer ${token}`;
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

test('手机号黑名单命中返回 REJECT 并落风险决策', async () => {
  await db`
    INSERT INTO risk.risk_black_white_list (
      id,
      entry_type,
      target_value,
      list_type,
      status,
      created_at
    )
    VALUES (
      'risk-mobile-black',
      'MOBILE',
      '13800130000',
      'BLACK',
      'ACTIVE',
      NOW()
    )
  `;

  const result = await runtime.services.risk.preCheck({
    channelId: 'seed-channel-demo',
    amount: 50,
    ip: '127.0.0.1',
    mobile: '13800130000',
  });
  const rows = await db<
    {
      decision: string;
      reason: string;
      contextJson: Record<string, unknown> | string;
    }[]
  >`
    SELECT
      decision,
      reason,
      context_json AS "contextJson"
    FROM risk.risk_decisions
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;

  expect(result).toMatchObject({
    decision: 'REJECT',
    reason: '命中手机号黑名单',
  });
  expect(rows[0]).toMatchObject({
    decision: 'REJECT',
    reason: '命中手机号黑名单',
  });
  const contextJson =
    typeof rows[0]?.contextJson === 'string'
      ? JSON.parse(rows[0].contextJson)
      : rows[0]?.contextJson;
  expect(contextJson).toMatchObject({
    mobile: '13800130000',
  });
});

test('同渠道同手机号短时间高频请求会触发风控拒绝', async () => {
  await db`
    INSERT INTO risk.risk_rules (
      id,
      rule_code,
      rule_name,
      rule_type,
      config_json,
      priority,
      status,
      created_at,
      updated_at
    )
    VALUES (
      'risk-frequency-rule',
      'MOBILE_FREQUENCY_REJECT',
      '手机号频控',
      'FREQUENCY',
      ${JSON.stringify({ seconds: 60, threshold: 2 })},
      1,
      'ACTIVE',
      NOW(),
      NOW()
    )
  `;

  const first = await runtime.services.risk.preCheck({
    channelId: 'seed-channel-demo',
    amount: 50,
    mobile: '13800130000',
  });
  const second = await runtime.services.risk.preCheck({
    channelId: 'seed-channel-demo',
    amount: 50,
    mobile: '13800130000',
  });
  const third = await runtime.services.risk.preCheck({
    channelId: 'seed-channel-demo',
    amount: 50,
    mobile: '13800130000',
  });

  expect(first.decision).toBe('PASS');
  expect(second.decision).toBe('PASS');
  expect(third).toMatchObject({
    decision: 'REJECT',
    reason: '手机号频率触发风控拒绝',
  });
});

test('后台可创建黑白名单并查询风险决策', async () => {
  const authorization = await buildAdminAuthorizationHeader();

  const createResponse = await runtime.app.handle(
    new Request('http://localhost/admin/risk/black-white-lists', {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        entryType: 'MOBILE',
        targetValue: '13900139000',
        listType: 'BLACK',
        remark: 'itest entry',
      }),
    }),
  );
  const createJson = (await createResponse.json()) as {
    code: number;
    data: Record<string, unknown>;
  };

  await runtime.services.risk.preCheck({
    channelId: 'seed-channel-demo',
    amount: 50,
    mobile: '13800130000',
    ip: '127.0.0.1',
  });

  const listResponse = await runtime.app.handle(
    new Request('http://localhost/admin/risk/decisions', {
      method: 'GET',
      headers: {
        authorization,
      },
    }),
  );
  const listJson = (await listResponse.json()) as {
    code: number;
    data: {
      records: Array<Record<string, unknown>>;
    };
  };

  expect(createResponse.status).toBe(200);
  expect(createJson.code).toBe(0);
  expect(createJson.data).toMatchObject({
    resourceType: 'RISK_BLACK_WHITE_ENTRY',
    status: 'ACTIVE',
  });
  expect(listResponse.status).toBe(200);
  expect(listJson.code).toBe(0);
  expect(Array.isArray(listJson.data.records)).toBe(true);
  expect(listJson.data.records[0]).toMatchObject({
    channelId: 'seed-channel-demo',
  });
});
