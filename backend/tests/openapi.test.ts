import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';

let runtime: Awaited<ReturnType<typeof buildApp>>;

const chineseTextPattern = /[\u3400-\u9fff]/;
const pendingOperations = new Set([
  'POST /internal/settlement/accounts/freeze',
  'POST /internal/settlement/accounts/unfreeze',
]);

function getExpectedTag(path: string) {
  if (path.startsWith('/open-api/')) {
    return 'open-api';
  }

  if (path.startsWith('/admin/')) {
    return 'admin';
  }

  if (path.startsWith('/internal/')) {
    return 'internal';
  }

  if (path.startsWith('/callbacks/')) {
    return 'callbacks';
  }

  if (path === '/health') {
    return 'internal';
  }

  return null;
}

beforeAll(async () => {
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime.stop();
});

describe('OpenAPI 文档服务', () => {
  test('/openapi/json 应返回 OpenAPI 规范', async () => {
    const response = await runtime.app.handle(new Request('http://localhost/openapi/json'));
    const json = (await response.json()) as {
      openapi?: string;
      info?: {
        title?: string;
        version?: string;
        description?: string;
      };
      tags?: Array<{ name?: string }>;
      paths?: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            summary?: string;
            description?: string;
          }
        >
      >;
    };

    expect(response.status).toBe(200);
    expect(json.openapi).toBeTruthy();
    expect(json.info).toMatchObject({
      title: 'ISP 话费充值平台 API',
      version: '1.0.0',
    });
    expect(json.tags?.some((tag) => tag.name === 'open-api')).toBe(true);
    expect(json.paths?.['/health']).toBeTruthy();
    expect(json.paths?.['/open-api/products/']?.get?.summary).toBe('列出可售充值商品');
    expect(json.paths?.['/open-api/products/']?.get?.tags).toContain('open-api');
  });

  test('所有接口都应提供中文名称、中文说明，并按前缀归类', async () => {
    const response = await runtime.app.handle(new Request('http://localhost/openapi/json'));
    const json = (await response.json()) as {
      paths?: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            summary?: string;
            description?: string;
          }
        >
      >;
    };

    expect(response.status).toBe(200);

    const operations = Object.entries(json.paths ?? {}).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({
        path,
        method: method.toUpperCase(),
        operation,
      })),
    );

    expect(operations.length).toBeGreaterThan(0);

    for (const { path, method, operation } of operations) {
      const expectedTag = getExpectedTag(path);
      const operationId = `${method} ${path}`;

      expect(operation.summary, `${operationId} 缺少中文名称`).toBeTruthy();
      expect(operation.description, `${operationId} 缺少中文说明`).toBeTruthy();
      expect(operation.summary, `${operationId} 名称需要中文`).toMatch(chineseTextPattern);
      expect(operation.description, `${operationId} 说明需要中文`).toMatch(chineseTextPattern);

      if (expectedTag) {
        expect(operation.tags, `${operationId} 缺少分类标签`).toContain(expectedTag);
      }

      if (pendingOperations.has(operationId)) {
        expect(operation.summary, `${operationId} 需要标记为待定`).toContain('（待定）');
      }
    }
  });
});
