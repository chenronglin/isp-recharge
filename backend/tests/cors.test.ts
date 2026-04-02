import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';

let runtime: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('CORS 预检请求', () => {
  test('允许 admin 前端从 localhost 开发端口访问登录接口', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/admin/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  test('允许 admin 前端从 127.0.0.1 开发端口访问登录接口', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/admin/auth/login', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://127.0.0.1:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });
});
