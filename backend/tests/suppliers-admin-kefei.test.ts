import { describe, expect, test } from 'bun:test';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { createSuppliersRoutes } from '@/modules/suppliers/suppliers.routes';
import type { SupplierSyncLog } from '@/modules/suppliers/suppliers.types';

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

describe('createSuppliersRoutes admin kefei apis', () => {
  test('GET /admin/suppliers/:supplierId/balance 返回供应商余额', async () => {
    const app = createSuppliersRoutes({
      suppliersService: {
        async getSupplierBalance(input: { supplierId: string }) {
          expect(input.supplierId).toBe('supplier-kefei');
          return {
            errorCode: 1,
            errorDesc: 'success',
            agentAccount: 'JG18948358181',
            agentName: '深圳科飞',
            agentBalance: 188.6,
            agentProfit: 23.4,
          };
        },
      } as never,
      iamService: {
        async requireActiveAdmin() {
          return {
            userId: 'seed-admin-user',
            username: 'admin',
            displayName: 'Admin',
            roleCodes: ['SUPER_ADMIN'],
          };
        },
      } as never,
    });

    const response = await app.handle(
      new Request('http://localhost/admin/suppliers/supplier-kefei/balance', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        agentAccount: string;
        agentBalance: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toMatchObject({
      agentAccount: 'JG18948358181',
      agentBalance: 188.6,
    });
  });

  test('POST /admin/suppliers/:supplierId/catalog/sync 手工触发目录同步', async () => {
    const app = createSuppliersRoutes({
      suppliersService: {
        async triggerCatalogSync(input: { supplierId: string }) {
          expect(input.supplierId).toBe('supplier-kefei');
          return {
            supplierCode: 'shenzhen-kefei',
            syncedProducts: ['cmcc-广东-50'],
          };
        },
      } as never,
      iamService: {
        async requireActiveAdmin() {
          return {
            userId: 'seed-admin-user',
            username: 'admin',
            displayName: 'Admin',
            roleCodes: ['SUPER_ADMIN'],
          };
        },
      } as never,
    });

    const response = await app.handle(
      new Request('http://localhost/admin/suppliers/supplier-kefei/catalog/sync', {
        method: 'POST',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        supplierCode: string;
        syncedProducts: string[];
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toEqual({
      supplierCode: 'shenzhen-kefei',
      syncedProducts: ['cmcc-广东-50'],
    });
  });

  test('GET /admin/suppliers/:supplierId/sync-logs 返回同步日志列表', async () => {
    const logs: SupplierSyncLog[] = [
      {
        id: 'sync-log-1',
        supplierId: 'supplier-kefei',
        syncType: 'FULL',
        status: 'SUCCESS',
        requestPayloadJson: { supplierCode: 'shenzhen-kefei', itemCount: 1 },
        responsePayloadJson: { syncedProducts: ['cmcc-广东-50'] },
        errorMessage: null,
        syncedAt: '2026-03-31T03:00:00.000Z',
      },
    ];
    const app = createSuppliersRoutes({
      suppliersService: {
        async listSyncLogs(input: { supplierId: string }) {
          expect(input.supplierId).toBe('supplier-kefei');
          return logs;
        },
      } as never,
      iamService: {
        async requireActiveAdmin() {
          return {
            userId: 'seed-admin-user',
            username: 'admin',
            displayName: 'Admin',
            roleCodes: ['SUPER_ADMIN'],
          };
        },
      } as never,
    });

    const response = await app.handle(
      new Request('http://localhost/admin/suppliers/supplier-kefei/sync-logs', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: SupplierSyncLog[];
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toEqual(logs);
  });
});
