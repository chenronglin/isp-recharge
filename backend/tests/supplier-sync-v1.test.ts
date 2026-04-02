import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import iconv from 'iconv-lite';

import { buildApp } from '@/app';
import {
  buildSeedMockSupplierProductCode,
  buildSeedRechargeProductCode,
  buildSeedRechargeProductId,
  runSeed,
} from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
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

function normalizeJsonLike(input: unknown) {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }

  return (input ?? {}) as Record<string, unknown>;
}

const ITEST_SHENZHEN_KEFEI_SUPPLIER_ID = 'itest-sync-supplier-shenzhen-kefei';
const ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE = 'itest-sync-shenzhen-kefei';
const seedGuangdongMixed50 = {
  productId: buildSeedRechargeProductId({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  }),
  productCode: buildSeedRechargeProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 50,
  }),
};
const seedGuangdongFast100 = {
  productCode: buildSeedRechargeProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'FAST',
    faceValue: 100,
  }),
  supplierProductCode: buildSeedMockSupplierProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'FAST',
    faceValue: 100,
  }),
};

async function seedShenzhenKefeiSupplier() {
  await db`
    INSERT INTO supplier.suppliers (
      id,
      supplier_code,
      supplier_name,
      protocol_type,
      status
    )
    VALUES (
      ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID},
      ${ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE},
      '深圳科飞',
      'SOHAN_API',
      'ACTIVE'
    )
    ON CONFLICT (supplier_code) DO UPDATE
    SET
      supplier_name = EXCLUDED.supplier_name,
      protocol_type = EXCLUDED.protocol_type,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
}

async function cleanupShenzhenKefeiSupplier() {
  await db`
    DELETE FROM product.product_supplier_mappings
    WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
  `;

  await db`
    DELETE FROM supplier.supplier_configs
    WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
  `;

  await db`
    DELETE FROM supplier.suppliers
    WHERE id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
       OR supplier_code = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE}
  `;
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  await runSeed(db);
  runtime = await buildApp({
    startWorkerScheduler: false,
  });
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

test('动态目录同步会刷新商品价格库存并记录同步日志', async () => {
  await runtime.services.suppliers.syncDynamicCatalog({
    supplierCode: 'mock-supplier',
    items: [
      {
        productCode: seedGuangdongMixed50.productCode,
        salesStatus: 'ON_SALE',
        purchasePrice: 47.25,
        inventoryQuantity: 88,
      },
    ],
  });

  const mappingRows = await db<
    {
      salesStatus: string;
      purchasePrice: string;
      inventoryQuantity: number;
      dynamicUpdatedAt: string | null;
    }[]
  >`
    SELECT
      sales_status AS "salesStatus",
      cost_price::text AS "purchasePrice",
      inventory_quantity AS "inventoryQuantity",
      dynamic_updated_at::text AS "dynamicUpdatedAt"
    FROM product.product_supplier_mappings
    WHERE product_id = ${seedGuangdongMixed50.productId}
      AND supplier_id = 'seed-supplier-mock'
    LIMIT 1
  `;
  const logRows = await db<
    {
      syncType: string;
      status: string;
      responsePayloadJson: Record<string, unknown>;
    }[]
  >`
    SELECT
      sync_type AS "syncType",
      status,
      response_payload_json AS "responsePayloadJson"
    FROM product.product_sync_logs
    ORDER BY created_at DESC
    LIMIT 1
  `;

  expect(mappingRows[0]).toMatchObject({
    salesStatus: 'ON_SALE',
    purchasePrice: '47.25',
    inventoryQuantity: 88,
  });
  expect(mappingRows[0]?.dynamicUpdatedAt).toBeTruthy();
  expect(logRows[0]).toMatchObject({
    syncType: 'DYNAMIC',
    status: 'SUCCESS',
  });
  expect(normalizeJsonLike(logRows[0]?.responsePayloadJson)).toMatchObject({
    updatedProducts: [seedGuangdongMixed50.productCode],
  });
});

test('全量目录同步会退役供应商缺失商品映射并让商品下架', async () => {
  await runtime.services.suppliers.syncFullCatalog({
    supplierCode: 'mock-supplier',
    items: [
      {
        productCode: seedGuangdongFast100.productCode,
        productName: '广东移动话费 100 元快充',
        carrierCode: 'CMCC',
        provinceName: '广东',
        faceValue: 100,
        rechargeMode: 'FAST',
        salesUnit: 'CNY',
        salesStatus: 'ON_SALE',
        purchasePrice: 95.5,
        inventoryQuantity: 120,
        supplierProductCode: seedGuangdongFast100.supplierProductCode,
      },
    ],
  });

  const mappingRows = await db<
    {
      status: string;
    }[]
  >`
    SELECT status
    FROM product.product_supplier_mappings
    WHERE product_id = ${seedGuangdongMixed50.productId}
      AND supplier_id = 'seed-supplier-mock'
    LIMIT 1
  `;
  const productRows = await db<
    {
      status: string;
    }[]
  >`
    SELECT
      status
    FROM product.recharge_products
    WHERE id = ${seedGuangdongMixed50.productId}
    LIMIT 1
  `;

  expect(mappingRows[0]?.status).toBe('INACTIVE');
  expect(productRows[0]).toMatchObject({
    status: 'ACTIVE',
  });
  await expect(
    runtime.services.products.matchRechargeProduct({
      mobile: '13800130000',
      faceValue: 50,
      productType: 'MIXED',
    }),
  ).rejects.toThrow('未匹配到可用充值商品');
});

test('全量目录同步命中现有业务键时会复用已有平台商品并只新增深圳科飞映射', async () => {
  await seedShenzhenKefeiSupplier();

  try {
    const adapter = new ShenzhenKefeiAdapter({
      baseUrl: 'https://supplier.example.com',
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      fetchImpl: (async () =>
        new Response(
          iconv.encode(
            JSON.stringify({
              errorCode: 1,
              dataset: [
                {
                  itemId: 'kefei-cmcc-gd-50',
                  itemName: '广东移动 50 元',
                  ispName: 'CMCC',
                  province: '广东',
                  parValue: 50,
                  inPrice: 47.25,
                  stock: 88,
                  salesStatus: 'ON_SALE',
                },
              ],
            }),
            'gbk',
          ),
        )) as typeof fetch,
    });
    const catalog = await adapter.syncCatalog();
    const synced = await runtime.services.suppliers.syncFullCatalog({
      supplierCode: ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE,
      items: catalog.items,
    });

    const productRows = await db<
      {
        id: string;
        productCode: string;
      }[]
    >`
      SELECT
        id,
        product_code AS "productCode"
      FROM product.recharge_products
      WHERE carrier_code = 'CMCC'
        AND province_name = '广东'
        AND face_value = 50
        AND recharge_mode = 'MIXED'
      ORDER BY created_at ASC, id ASC
    `;
    const kefeiRows = await db<
      {
        productId: string;
        supplierProductCode: string;
        priority: number;
        routeType: string;
        status: string;
      }[]
    >`
      SELECT
        product_id AS "productId",
        supplier_product_code AS "supplierProductCode",
        priority,
        route_type AS "routeType",
        status
      FROM product.product_supplier_mappings
      WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
      LIMIT 1
    `;

    expect(synced).toEqual({
      syncedProducts: [seedGuangdongMixed50.productCode],
    });
    expect(productRows).toEqual([
      {
        id: seedGuangdongMixed50.productId,
        productCode: seedGuangdongMixed50.productCode,
      },
    ]);
    expect(kefeiRows).toEqual([
      {
        productId: seedGuangdongMixed50.productId,
        supplierProductCode: 'kefei-cmcc-gd-50',
        priority: 0,
        routeType: 'PRIMARY',
        status: 'ACTIVE',
      },
    ]);
  } finally {
    await cleanupShenzhenKefeiSupplier();
  }
});

test('全量目录同步遇到平台未预置的业务键时不会创建新平台商品', async () => {
  await seedShenzhenKefeiSupplier();

  try {
    const beforeRows = await db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM product.recharge_products
    `;

    const synced = await runtime.services.suppliers.syncFullCatalog({
      supplierCode: ITEST_SHENZHEN_KEFEI_SUPPLIER_CODE,
      items: [
        {
          productCode: 'cmcc-全国-999',
          productName: '全国移动 999 元',
          carrierCode: 'CMCC',
          provinceName: '全国',
          faceValue: 999,
          rechargeMode: 'MIXED',
          salesUnit: 'CNY',
          salesStatus: 'ON_SALE',
          purchasePrice: 950,
          inventoryQuantity: 10,
          supplierProductCode: 'kefei-unsupported-999',
        },
      ],
    });

    const afterRows = await db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM product.recharge_products
    `;
    const mappingRows = await db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM product.product_supplier_mappings
      WHERE supplier_id = ${ITEST_SHENZHEN_KEFEI_SUPPLIER_ID}
    `;

    expect(synced).toEqual({
      syncedProducts: [],
    });
    expect(afterRows[0]?.total).toBe(beforeRows[0]?.total);
    expect(mappingRows[0]?.total).toBe(0);
  } finally {
    await cleanupShenzhenKefeiSupplier();
  }
});
