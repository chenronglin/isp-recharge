import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildApp } from '@/app';
import {
  buildSeedRechargeProductCode,
  buildSeedRechargeProductId,
  runSeed,
} from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>>;

const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');
const seedGuangdongMixed30 = {
  productId: buildSeedRechargeProductId({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'MIXED',
    faceValue: 30,
  }),
};
const seedGuangdongFast100 = {
  productId: buildSeedRechargeProductId({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'FAST',
    faceValue: 100,
  }),
  productCode: buildSeedRechargeProductCode({
    carrierCode: 'CMCC',
    provinceName: '广东',
    productType: 'FAST',
    faceValue: 100,
  }),
};

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
  await runSeed(db);
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  runtime = await buildApp({ startWorkerScheduler: false });
});

afterAll(() => {
  runtime?.stop();
  return releaseIntegrationTestLock();
});

describe('ISP 充值商品匹配', () => {
  test('默认不传 product_type 时命中混充商品', async () => {
    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
    });

    expect(matched.mobileContext.province).toBe('广东');
    expect(matched.mobileContext.ispName).toBe('CMCC');
    expect(matched.product.productType).toBe('MIXED');
  });

  test('传 FAST 时命中快充商品', async () => {
    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
      productType: 'FAST',
    });

    expect(matched.product.productType).toBe('FAST');
  });

  test('未命中省份商品时回退到全国商品', async () => {
    await db`
      UPDATE product.product_supplier_mappings
      SET
        status = 'INACTIVE'
      WHERE product_id = ${seedGuangdongMixed30.productId}
        AND supplier_id = 'seed-supplier-mock'
    `;

    await db`
      INSERT INTO product.recharge_products (
        id,
        product_code,
        product_name,
        carrier_code,
        province_name,
        face_value,
        recharge_mode,
        sales_unit,
        status
      )
      VALUES (
        'itest-product-cmcc-national-30',
        'itest-cmcc-national-30',
        '全国移动慢充 30 元',
        'CMCC',
        '全国',
        30,
        'MIXED',
        'CNY',
        'ACTIVE'
      )
    `;
    await db`
      INSERT INTO product.product_supplier_mappings (
        id,
        product_id,
        supplier_id,
        supplier_product_code,
        route_type,
        priority,
        cost_price,
        status
      )
      VALUES (
        'itest-product-mapping-cmcc-national-30',
        'itest-product-cmcc-national-30',
        'seed-supplier-mock',
        'itest-cmcc-national-30',
        'PRIMARY',
        1,
        29,
        'ACTIVE'
      )
    `;

    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 30,
    });

    expect(matched.product.productCode).toBe('itest-cmcc-national-30');
    expect(matched.product.provinceName).toBe('全国');
  });

  test('命中多个有效商品时不会按创建时间静默兜底', async () => {
    await db`
      INSERT INTO product.recharge_products (
        id,
        product_code,
        product_name,
        carrier_code,
        province_name,
        face_value,
        recharge_mode,
        sales_unit,
        status
      )
      VALUES
        (
          'itest-duplicate-product-1',
          'itest-duplicate-1',
          '广东移动慢充 80 元 A',
          'CMCC',
          '广东',
          80,
          'MIXED',
          'CNY',
          'ACTIVE'
        ),
        (
          'itest-duplicate-product-2',
          'itest-duplicate-2',
          '广东移动慢充 80 元 B',
          'CMCC',
          '广东',
          80,
          'MIXED',
          'CNY',
          'ACTIVE'
        )
    `;
    await db`
      INSERT INTO product.product_supplier_mappings (
        id,
        product_id,
        supplier_id,
        supplier_product_code,
        route_type,
        priority,
        cost_price,
        status
      )
      VALUES
        (
          'itest-duplicate-mapping-1',
          'itest-duplicate-product-1',
          'seed-supplier-mock',
          'itest-duplicate-1',
          'PRIMARY',
          1,
          79,
          'ACTIVE'
        ),
        (
          'itest-duplicate-mapping-2',
          'itest-duplicate-product-2',
          'seed-supplier-mock',
          'itest-duplicate-2',
          'PRIMARY',
          1,
          79,
          'ACTIVE'
        )
    `;

    await expect(
      runtime.services.products.matchRechargeProduct({
        mobile: '13800138000',
        faceValue: 80,
      }),
    ).rejects.toThrow('命中多个有效充值商品');
  });

  test('动态刷新将商品置为不可售后不会继续参与路由', async () => {
    await db`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        protocol_type,
        status
      )
      VALUES (
        'itest-supplier-alt',
        'alt-supplier',
        '备用供应商',
        'MOCK',
        'ACTIVE'
      )
      ON CONFLICT (supplier_code) DO NOTHING
    `;
    await db`
      INSERT INTO product.product_supplier_mappings (
        id,
        product_id,
        supplier_id,
        supplier_product_code,
        route_type,
        priority,
        cost_price,
        sales_status,
        inventory_quantity,
        dynamic_updated_at,
        status
      )
      VALUES (
        'itest-mapping-fast-100-alt',
        ${seedGuangdongFast100.productId},
        'itest-supplier-alt',
        'alt-fast-100',
        'PRIMARY',
        2,
        94,
        'ON_SALE',
        50,
        NOW(),
        'ACTIVE'
      )
      ON CONFLICT (product_id, supplier_id) DO NOTHING
    `;

    await runtime.services.suppliers.syncDynamicCatalog({
      supplierCode: 'mock-supplier',
      items: [
        {
          productCode: seedGuangdongFast100.productCode,
          salesStatus: 'MAINTENANCE',
          purchasePrice: 96,
          inventoryQuantity: 0,
        },
      ],
    });

    const matched = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
      productType: 'FAST',
    });

    expect(matched.product.productCode).toBe(seedGuangdongFast100.productCode);
    expect(matched.supplierCandidates).toHaveLength(1);
    expect(matched.supplierCandidates[0]).toMatchObject({
      supplierId: 'itest-supplier-alt',
      supplierProductCode: 'alt-fast-100',
    });
  });

  test('映射在 120 分钟内未刷新仍可售，超过 120 分钟后会被判定为过期', async () => {
    await db`
      UPDATE product.product_supplier_mappings
      SET
        status = 'INACTIVE'
      WHERE product_id = ${seedGuangdongFast100.productId}
        AND supplier_id = 'itest-supplier-alt'
    `;

    await db`
      UPDATE product.product_supplier_mappings
      SET
        sales_status = 'ON_SALE',
        inventory_quantity = 100,
        dynamic_updated_at = NOW() - INTERVAL '90 minutes'
      WHERE product_id = ${seedGuangdongFast100.productId}
        AND supplier_id = 'seed-supplier-mock'
    `;

    const freshEnough = await runtime.services.products.matchRechargeProduct({
      mobile: '13800138000',
      faceValue: 100,
      productType: 'FAST',
    });

    expect(freshEnough.supplierCandidates).toHaveLength(1);

    await db`
      UPDATE product.product_supplier_mappings
      SET
        dynamic_updated_at = NOW() - INTERVAL '121 minutes'
      WHERE product_id = ${seedGuangdongFast100.productId}
        AND supplier_id = 'seed-supplier-mock'
    `;

    await expect(
      runtime.services.products.matchRechargeProduct({
        mobile: '13800138000',
        faceValue: 100,
        productType: 'FAST',
      }),
    ).rejects.toThrow('未匹配到可用充值商品');
  });
});
