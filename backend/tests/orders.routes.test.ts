import { describe, expect, test } from 'bun:test';

import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { createOrdersRoutes } from '@/modules/orders/orders.routes';

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

describe('createOrdersRoutes', () => {
  test('admin retry-notify dispatches retry logic instead of marking notification failed', async () => {
    let retryNotificationCalls = 0;
    let handleNotificationFailedCalls = 0;

    const app = createOrdersRoutes({
      ordersService: {
        async retryNotification(orderNo: string) {
          retryNotificationCalls += 1;
          expect(orderNo).toBe('order-1');
        },
        async handleNotificationFailed() {
          handleNotificationFailedCalls += 1;
        },
        async getOrderByNo() {
          return {
            orderNo: 'order-1',
          };
        },
      } as never,
      channelsService: {
        async authenticateOpenRequest() {
          throw new Error('authenticateOpenRequest should not run in admin route test');
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
      new Request('http://localhost/admin/orders/order-1/retry-notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: await buildAdminAuthorizationHeader(),
        },
        body: JSON.stringify({
          reason: 'manual retry',
        }),
      }),
    );
    const payload = (await response.json()) as {
      code: number;
    };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(retryNotificationCalls).toBe(1);
    expect(handleNotificationFailedCalls).toBe(0);
  });
});
