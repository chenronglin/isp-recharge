import { describe, expect, test } from 'bun:test';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { createSuppliersRoutes } from '@/modules/suppliers/suppliers.routes';
import type {
  SupplierReconcileDiff,
  SupplierSyncLog,
} from '@/modules/suppliers/suppliers.types';

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

  test('GET /admin/suppliers/reconcile-diffs 返回差异列表', async () => {
    const diffs: SupplierReconcileDiff[] = [
      {
        id: 'diff-1',
        supplierId: 'supplier-kefei',
        reconcileDate: '2026-04-03',
        orderNo: 'ORD-1',
        diffType: 'INFLIGHT_STATUS_MISMATCH',
        diffAmount: 48.5,
        detailsJson: {
          supplierOrderNo: 'KF-1',
        },
        status: 'OPEN',
        createdAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
      },
    ];
    const app = createSuppliersRoutes({
      suppliersService: {
        async listReconcileDiffs(input: { reconcileDate?: string; orderNo?: string }) {
          expect(input).toEqual({
            reconcileDate: '2026-04-03',
            orderNo: 'ORD-1',
          });
          return diffs;
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
      new Request('http://localhost/admin/suppliers/reconcile-diffs?reconcileDate=2026-04-03&orderNo=ORD-1', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: SupplierReconcileDiff[];
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toEqual(diffs);
  });

  test('POST /admin/suppliers/:supplierId/recover-circuit-breaker 返回恢复后的熔断状态', async () => {
    const app = createSuppliersRoutes({
      suppliersService: {
        async recoverCircuitBreaker(input: { supplierId: string }) {
          expect(input.supplierId).toBe('supplier-kefei');
          return {
            id: 'breaker-1',
            supplierId: 'supplier-kefei',
            breakerStatus: 'CLOSED',
            failCountWindow: 0,
            failThreshold: 3,
            openedAt: null,
            lastProbeAt: '2026-04-03T10:30:00.000Z',
            recoveryTimeoutSeconds: 1800,
            createdAt: '2026-04-03T10:00:00.000Z',
            updatedAt: '2026-04-03T10:30:00.000Z',
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
      new Request('http://localhost/admin/suppliers/supplier-kefei/recover-circuit-breaker', {
        method: 'POST',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const payload = (await response.json()) as {
      code: number;
      data: {
        breakerStatus: string;
        supplierId: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data).toMatchObject({
      breakerStatus: 'CLOSED',
      supplierId: 'supplier-kefei',
    });
  });
});
