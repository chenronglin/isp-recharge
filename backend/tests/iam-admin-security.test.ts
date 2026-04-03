import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

const roleIdsByCode = {
  SUPER_ADMIN: 'seed-role-super-admin',
  OPS: 'seed-role-ops',
  FINANCE: 'seed-role-finance',
  RISK: 'seed-role-risk',
  SUPPORT: 'seed-role-support',
} as const;

type AdminRoleCode = keyof typeof roleIdsByCode;

async function buildAdminAuthorizationHeader(userId: string, roleCodes: AdminRoleCode[]) {
  const token = await signJwt(
    {
      sub: userId,
      type: 'admin',
      roleIds: roleCodes,
      scope: 'admin',
      jti: `itest-admin-${userId}-${Date.now()}`,
    },
    env.adminJwtSecret,
    900,
  );

  return `Bearer ${token}`;
}

async function createAdminUser(input: {
  userId: string;
  username: string;
  displayName: string;
  status?: 'ACTIVE' | 'DISABLED';
  roleCodes?: AdminRoleCode[];
}) {
  await db`
    INSERT INTO iam.admin_users (
      id,
      username,
      password_hash,
      display_name,
      status
    )
    VALUES (
      ${input.userId},
      ${input.username},
      'test-password-hash',
      ${input.displayName},
      ${input.status ?? 'ACTIVE'}
    )
    ON CONFLICT (username) DO UPDATE
    SET
      display_name = EXCLUDED.display_name,
      password_hash = EXCLUDED.password_hash,
      status = EXCLUDED.status,
      failed_login_attempts = 0,
      locked_until = NULL,
      updated_at = NOW()
  `;

  for (const roleCode of input.roleCodes ?? []) {
    await db`
      INSERT INTO iam.user_role_relations (user_id, role_id, created_at)
      VALUES (${input.userId}, ${roleIdsByCode[roleCode]}, NOW())
      ON CONFLICT (user_id, role_id) DO NOTHING
    `;
  }
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

describe('IAM 权限与审计', () => {
  test('连续输错密码会临时锁定账号，并可分页查询登录日志', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await runtime.app.handle(
        new Request('http://localhost/admin/auth/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            username: env.seed.adminUsername,
            password: `wrong-password-${attempt}`,
          }),
        }),
      );

      expect(response.status).toBe(attempt < 5 ? 401 : 403);
    }

    const lockedResponse = await runtime.app.handle(
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

    const logSummaryRows = await db<{ total: number; lockedCount: number }[]>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE failure_reason = 'ACCOUNT_LOCKED')::int AS "lockedCount"
      FROM iam.login_logs
      WHERE username = ${env.seed.adminUsername}
    `;

    const loginLogsResponse = await runtime.app.handle(
      new Request('http://localhost/admin/login-logs?page=1&pageSize=20', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader('seed-admin-user', ['SUPER_ADMIN']),
        },
      }),
    );
    const loginLogsPayload = (await loginLogsResponse.json()) as {
      code: number;
      data: {
        items: Array<{
          username: string;
          result: string;
          failureReason: string | null;
        }>;
      };
    };

    expect(lockedResponse.status).toBe(403);
    expect(logSummaryRows[0]?.total).toBe(6);
    expect(logSummaryRows[0]?.lockedCount).toBeGreaterThanOrEqual(2);
    expect(loginLogsResponse.status).toBe(200);
    expect(loginLogsPayload.code).toBe(0);
    expect(loginLogsPayload.data.items.some((item) => item.username === env.seed.adminUsername)).toBe(
      true,
    );
  });

  test('超级管理员可停用后台用户，并写入审计日志', async () => {
    await createAdminUser({
      userId: 'audit-user-status',
      username: 'audit-status-user',
      displayName: 'Audit Status User',
      roleCodes: ['OPS'],
    });

    const response = await runtime.app.handle(
      new Request('http://localhost/admin/users/audit-user-status/status', {
        method: 'PATCH',
        headers: {
          authorization: await buildAdminAuthorizationHeader('seed-admin-user', ['SUPER_ADMIN']),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'DISABLED',
        }),
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        id: string;
        status: string;
      };
    };
    const auditRows = await db<
      {
        action: string;
        resourceId: string;
      }[]
    >`
      SELECT
        action,
        resource_id AS "resourceId"
      FROM iam.operation_audit_logs
      WHERE action = 'UPDATE_ADMIN_USER_STATUS'
        AND resource_id = 'audit-user-status'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toMatchObject({
      id: 'audit-user-status',
      status: 'DISABLED',
    });
    expect(auditRows[0]).toMatchObject({
      action: 'UPDATE_ADMIN_USER_STATUS',
      resourceId: 'audit-user-status',
    });
  });

  test('超级管理员可分配角色，审计日志可查，角色权限即时生效', async () => {
    await createAdminUser({
      userId: 'finance-user-1',
      username: 'finance-user',
      displayName: 'Finance User',
    });
    await createAdminUser({
      userId: 'ops-user-1',
      username: 'ops-user',
      displayName: 'Ops User',
      roleCodes: ['OPS'],
    });

    const assignRoleResponse = await runtime.app.handle(
      new Request('http://localhost/admin/users/finance-user-1/roles', {
        method: 'POST',
        headers: {
          authorization: await buildAdminAuthorizationHeader('seed-admin-user', ['SUPER_ADMIN']),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          roleCode: 'FINANCE',
        }),
      }),
    );
    const auditLogsResponse = await runtime.app.handle(
      new Request('http://localhost/admin/audit-logs?page=1&pageSize=20', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader('seed-admin-user', ['SUPER_ADMIN']),
        },
      }),
    );
    const financeAccountsResponse = await runtime.app.handle(
      new Request('http://localhost/admin/accounts', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader('finance-user-1', ['FINANCE']),
        },
      }),
    );
    const opsAccountsResponse = await runtime.app.handle(
      new Request('http://localhost/admin/accounts', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader('ops-user-1', ['OPS']),
        },
      }),
    );
    const relationRows = await db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM iam.user_role_relations
      WHERE user_id = 'finance-user-1'
        AND role_id = ${roleIdsByCode.FINANCE}
    `;
    const auditLogsPayload = (await auditLogsResponse.json()) as {
      code: number;
      data: {
        items: Array<{
          action: string;
          resourceId: string | null;
        }>;
      };
    };

    expect(assignRoleResponse.status).toBe(200);
    expect(relationRows[0]?.total).toBe(1);
    expect(auditLogsResponse.status).toBe(200);
    expect(auditLogsPayload.code).toBe(0);
    expect(
      auditLogsPayload.data.items.some(
        (item) =>
          item.action === 'ASSIGN_ADMIN_USER_ROLE' && item.resourceId === 'finance-user-1',
      ),
    ).toBe(true);
    expect(financeAccountsResponse.status).toBe(200);
    expect(opsAccountsResponse.status).toBe(403);
  });
});
