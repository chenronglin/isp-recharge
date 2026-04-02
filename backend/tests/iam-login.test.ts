import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { env } from '@/lib/env';
import { db } from '@/lib/sql';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

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

describe('管理员登录', () => {
  test('登录成功后应写入 refresh session', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/admin/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          username: env.seed.adminUsername,
          password: env.seed.adminPassword,
        }),
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data?: {
        accessToken?: string;
        refreshToken?: string;
      };
    };
    const sessionRows = await db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM iam.login_sessions
      WHERE user_id = 'seed-admin-user'
        AND status = 'ACTIVE'
    `;

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data?.accessToken).toBeTruthy();
    expect(payload.data?.refreshToken).toBeTruthy();
    expect(sessionRows[0]?.total).toBe(1);
  });
});
