import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import {
  buildSeedRechargeProductCode,
  buildSeedRechargeProductId,
  FIXED_RECHARGE_PRODUCT_COUNT,
  runSeed,
} from '@/database/seeds/0001_base.seed';
import { env } from '@/lib/env';
import { signJwt } from '@/lib/jwt-token';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

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

function buildSignedGetHeaders(path: string) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${Date.now()}`;
  const canonical = buildOpenApiCanonicalString({
    method: 'GET',
    path,
    timestamp,
    nonce,
    body: '',
  });

  return {
    AccessKey: 'demo-access-key',
    Sign: signOpenApiPayload('demo-secret-key', canonical),
    Timestamp: timestamp,
    Nonce: nonce,
  };
}

async function resetProductsState() {
  await db`
    TRUNCATE TABLE
      product.product_supplier_mappings,
      product.recharge_products,
      product.mobile_segments,
      channel.channel_price_policies,
      channel.channel_product_authorizations,
      channel.channel_callback_configs,
      channel.channel_request_nonces,
      channel.channel_limit_rules,
      channel.channel_api_credentials,
      channel.channels,
      supplier.supplier_configs,
      supplier.suppliers,
      ledger.accounts,
      iam.operation_audit_logs
    CASCADE
  `;

  await runSeed(db);
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  runtime = await buildApp({ startWorkerScheduler: false });
});

beforeEach(async () => {
  await resetProductsState();
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe('平台商品后台维护', () => {
  test('POST /admin/products 可以创建新的平台商品主数据', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/admin/products', {
        method: 'POST',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          productCode: 'cmcc-guangdong-fast-300',
          productName: '广东移动话费 300 元快充',
          carrierCode: 'CMCC',
          provinceName: '广东',
          faceValue: 300,
          productType: 'FAST',
          salesUnit: 'cny',
          status: 'ACTIVE',
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
      resourceId: expect.any(String),
      resourceType: 'RECHARGE_PRODUCT',
      status: 'ACTIVE',
    });

    const adminListResponse = await runtime.app.handle(
      new Request('http://localhost/admin/products?keyword=cmcc-guangdong-fast-300&pageSize=20', {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const adminListPayload = (await adminListResponse.json()) as {
      code: number;
      data: {
        records: Array<{ productCode: string }>;
      };
    };

    expect(adminListResponse.status).toBe(200);
    expect(adminListPayload.code).toBe(0);
    expect(adminListPayload.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: 'cmcc-guangdong-fast-300',
        }),
      ]),
    );
  });

  test('POST /admin/products 会拦截重复的业务键', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/admin/products', {
        method: 'POST',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          productCode: 'ctcc-shanghai-mixed-50-alt',
          productName: '上海电信话费 50 元混充备用',
          carrierCode: 'CTCC',
          provinceName: '上海',
          faceValue: 50,
          productType: 'MIXED',
          salesUnit: 'CNY',
          status: 'ACTIVE',
        }),
      }),
    );
    const payload = await response.text();

    expect(response.status).toBe(409);
    expect(payload).toContain('运营商、地区、面额与充值模式组合已存在');
  });

  test('PUT /admin/products/:productId 可以修改平台商品且后台列表保留停用商品', async () => {
    const productId = buildSeedRechargeProductId({
      carrierCode: 'CMCC',
      provinceName: '广东',
      productType: 'MIXED',
      faceValue: 50,
    });
    const productCode = buildSeedRechargeProductCode({
      carrierCode: 'CMCC',
      provinceName: '广东',
      productType: 'MIXED',
      faceValue: 50,
    });

    const response = await runtime.app.handle(
      new Request(`http://localhost/admin/products/${productId}`, {
        method: 'PUT',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          productCode,
          productName: '广东移动话费 50 元混充（停用）',
          carrierCode: 'CMCC',
          provinceName: '广东',
          faceValue: 50,
          productType: 'MIXED',
          salesUnit: 'CNY',
          status: 'INACTIVE',
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
      resourceId: productId,
      resourceType: 'RECHARGE_PRODUCT',
      status: 'INACTIVE',
    });

    const adminListResponse = await runtime.app.handle(
      new Request(`http://localhost/admin/products?keyword=${productCode}&pageSize=20`, {
        method: 'GET',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
        },
      }),
    );
    const adminListPayload = (await adminListResponse.json()) as {
      code: number;
      data: {
        records: Array<{ id: string; status: string }>;
      };
    };

    expect(adminListResponse.status).toBe(200);
    expect(adminListPayload.code).toBe(0);
    expect(adminListPayload.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: productId,
          status: 'INACTIVE',
        }),
      ]),
    );

    const openListResponse = await runtime.app.handle(
      new Request('http://localhost/open-api/products/', {
        method: 'GET',
        headers: buildSignedGetHeaders('/open-api/products/'),
      }),
    );
    const openListPayload = (await openListResponse.json()) as {
      code: number;
      data: Array<{ productCode: string }>;
    };

    expect(openListResponse.status).toBe(200);
    expect(openListPayload.code).toBe(0);
    expect(openListPayload.data.length).toBe(FIXED_RECHARGE_PRODUCT_COUNT - 1);
    expect(openListPayload.data.map((item) => item.productCode)).not.toContain(productCode);
  });

  test('PUT /admin/products/:productId 会拦截重复的 productCode', async () => {
    const productId = buildSeedRechargeProductId({
      carrierCode: 'CTCC',
      provinceName: '广东',
      productType: 'MIXED',
      faceValue: 50,
    });
    const duplicateProductCode = buildSeedRechargeProductCode({
      carrierCode: 'CMCC',
      provinceName: '广东',
      productType: 'MIXED',
      faceValue: 50,
    });

    const response = await runtime.app.handle(
      new Request(`http://localhost/admin/products/${productId}`, {
        method: 'PUT',
        headers: {
          authorization: await buildAdminAuthorizationHeader(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          productCode: duplicateProductCode,
          productName: '广东电信话费 50 元混充',
          carrierCode: 'CTCC',
          provinceName: '广东',
          faceValue: 50,
          productType: 'MIXED',
          salesUnit: 'CNY',
          status: 'ACTIVE',
        }),
      }),
    );
    const payload = await response.text();

    expect(response.status).toBe(409);
    expect(payload).toContain('productCode 已存在');
  });
});
