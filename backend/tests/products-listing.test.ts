import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { buildOpenApiCanonicalString, signOpenApiPayload } from '@/lib/security';
import { db } from '@/lib/sql';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

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
      ledger.accounts
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

describe('充值商品列表', () => {
  test('开放接口可以列出当前可售商品', async () => {
    const response = await runtime.app.handle(
      new Request('http://localhost/open-api/products/', {
        method: 'GET',
        headers: buildSignedGetHeaders('/open-api/products/'),
      }),
    );
    const json = (await response.json()) as {
      code: number;
      data: Array<{ productCode: string }>;
    };

    expect(response.status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.data.map((item) => item.productCode)).toEqual(
      expect.arrayContaining(['cmcc-mixed-50', 'cmcc-fast-100']),
    );
  });
});
