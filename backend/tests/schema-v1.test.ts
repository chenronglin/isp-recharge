import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  buildSeedRechargeProductCode,
  FIXED_RECHARGE_PRODUCT_COUNT,
  runSeed,
} from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import { acquireIntegrationTestLock, releaseIntegrationTestLock } from './test-support';

const managedSchemas = [
  'iam',
  'channel',
  'product',
  'ordering',
  'supplier',
  'ledger',
  'risk',
  'notification',
  'worker',
] as const;

const expectedTablesBySchema = {
  channel: [
    'channel_api_credentials',
    'channel_callback_configs',
    'channel_limit_rules',
    'channel_price_policies',
    'channel_product_authorizations',
    'channel_request_nonces',
    'channels',
  ],
  iam: ['admin_users', 'login_sessions', 'operation_audit_logs', 'roles', 'user_role_relations'],
  ledger: ['account_ledgers', 'accounts'],
  notification: ['notification_dead_letters', 'notification_delivery_logs', 'notification_tasks'],
  ordering: ['order_events', 'orders'],
  product: [
    'mobile_segments',
    'product_supplier_mappings',
    'product_sync_logs',
    'recharge_products',
  ],
  risk: ['risk_black_white_list', 'risk_decisions', 'risk_rules'],
  supplier: [
    'supplier_callback_logs',
    'supplier_configs',
    'supplier_orders',
    'supplier_reconcile_diffs',
    'supplier_request_logs',
    'supplier_runtime_breakers',
    'suppliers',
  ],
  worker: ['worker_dead_letters', 'worker_job_attempts', 'worker_jobs'],
} satisfies Record<(typeof managedSchemas)[number], string[]>;

const migrationFile = join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql');
const incrementalMigrationFile = join(
  import.meta.dir,
  '../src/database/migrations/0002_add_login_sessions.sql',
);

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

beforeAll(async () => {
  await acquireIntegrationTestLock();
});

afterAll(() => releaseIntegrationTestLock());

test('数据库应只重建 ISP 充值 V1 所需核心表', async () => {
  await rebuildManagedSchemas();

  const rows = await db.unsafe<{ table_schema: string; table_name: string }[]>(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN (
      'iam',
      'channel',
      'product',
      'ordering',
      'supplier',
      'ledger',
      'risk',
      'notification',
      'worker'
    )
    ORDER BY table_schema ASC, table_name ASC
  `);

  const actual = Object.fromEntries(
    Object.entries(Object.groupBy(rows, (row) => row.table_schema)).map(([schema, schemaRows]) => [
      schema,
      (schemaRows ?? []).map((row) => row.table_name),
    ]),
  );

  expect(actual).toEqual(
    Object.fromEntries(
      Object.entries(expectedTablesBySchema).map(([schema, tables]) => [
        schema,
        tables.slice().sort(),
      ]),
    ),
  );
});

test('基础种子只应注入 ISP 充值 V1 必需演示数据', async () => {
  await rebuildManagedSchemas();
  await runSeed(db);

  const adminRows = await db.unsafe<{ username: string; display_name: string; status: string }[]>(`
    SELECT username, display_name, status
    FROM iam.admin_users
    ORDER BY username ASC
  `);
  const channelRows = await db.unsafe<
    { channel_code: string; channel_name: string; status: string }[]
  >(`
    SELECT channel_code, channel_name, status
    FROM channel.channels
    ORDER BY channel_code ASC
  `);
  const supplierRows = await db.unsafe<
    { supplier_code: string; supplier_name: string; status: string }[]
  >(`
    SELECT supplier_code, supplier_name, status
    FROM supplier.suppliers
    ORDER BY supplier_code ASC
  `);
  const productCountRows = await db.unsafe<{ total: number }[]>(`
    SELECT COUNT(*)::int AS total
    FROM product.recharge_products
  `);
  const sampleProductRows = await db.unsafe<
    { product_code: string; product_name: string; recharge_mode: string; carrier_code: string }[]
  >(`
    SELECT product_code, product_name, recharge_mode, carrier_code
    FROM product.recharge_products
    WHERE product_code IN (
      '${buildSeedRechargeProductCode({
        carrierCode: 'CMCC',
        provinceName: '广东',
        productType: 'MIXED',
        faceValue: 50,
      })}',
      '${buildSeedRechargeProductCode({
        carrierCode: 'CTCC',
        provinceName: '北京',
        productType: 'FAST',
        faceValue: 10,
      })}',
      '${buildSeedRechargeProductCode({
        carrierCode: 'CBN',
        provinceName: '新疆',
        productType: 'MIXED',
        faceValue: 200,
      })}'
    )
    ORDER BY product_code ASC
  `);
  const segmentRows = await db.unsafe<
    { mobile_prefix: string; province_name: string; isp_code: string }[]
  >(`
    SELECT mobile_prefix, province_name, isp_code
    FROM product.mobile_segments
    ORDER BY mobile_prefix ASC
  `);
  const authCountRows = await db.unsafe<{ total: number }[]>(`
    SELECT COUNT(*)::int AS total
    FROM channel.channel_product_authorizations
  `);
  const priceCountRows = await db.unsafe<{ total: number }[]>(`
    SELECT COUNT(*)::int AS total
    FROM channel.channel_price_policies
  `);
  const callbackCountRows = await db.unsafe<{ total: number }[]>(`
    SELECT COUNT(*)::int AS total
    FROM channel.channel_callback_configs
  `);
  const accountRows = await db.unsafe<
    { owner_type: string; available_balance: string; frozen_balance: string }[]
  >(`
    SELECT owner_type, available_balance::text, frozen_balance::text
    FROM ledger.accounts
    ORDER BY owner_type ASC, owner_id ASC
  `);

  expect(adminRows).toEqual([
    { username: 'admin', display_name: '平台超级管理员', status: 'ACTIVE' },
  ]);
  expect(channelRows).toEqual([
    { channel_code: 'demo-channel', channel_name: '演示渠道', status: 'ACTIVE' },
  ]);
  expect(supplierRows).toEqual([
    { supplier_code: 'mock-supplier', supplier_name: '模拟供应商', status: 'ACTIVE' },
    { supplier_code: 'shenzhen-kefei', supplier_name: '深圳科飞', status: 'ACTIVE' },
  ]);
  expect(productCountRows[0]?.total).toBe(FIXED_RECHARGE_PRODUCT_COUNT);
  expect(sampleProductRows).toEqual([
    {
      product_code: 'cbn-xinjiang-mixed-200',
      product_name: '新疆广电话费 200 元混充',
      recharge_mode: 'MIXED',
      carrier_code: 'CBN',
    },
    {
      product_code: 'cmcc-guangdong-mixed-50',
      product_name: '广东移动话费 50 元混充',
      recharge_mode: 'MIXED',
      carrier_code: 'CMCC',
    },
    {
      product_code: 'ctcc-beijing-fast-10',
      product_name: '北京电信话费 10 元快充',
      recharge_mode: 'FAST',
      carrier_code: 'CTCC',
    },
  ]);
  expect(segmentRows).toEqual([
    { mobile_prefix: '1380013', province_name: '广东', isp_code: 'CMCC' },
  ]);
  expect(authCountRows[0]?.total).toBe(FIXED_RECHARGE_PRODUCT_COUNT);
  expect(priceCountRows[0]?.total).toBe(FIXED_RECHARGE_PRODUCT_COUNT);
  expect(callbackCountRows[0]?.total).toBe(1);
  expect(accountRows).toEqual([
    { owner_type: 'CHANNEL', available_balance: '10000.00', frozen_balance: '0.00' },
    { owner_type: 'PLATFORM', available_balance: '0.00', frozen_balance: '0.00' },
    { owner_type: 'SUPPLIER', available_balance: '0.00', frozen_balance: '0.00' },
  ]);
});

test('增量迁移应为旧环境补建 login_sessions 表', async () => {
  await rebuildManagedSchemas();
  await db.unsafe(`
    DROP TABLE IF EXISTS iam.login_sessions;
  `);

  await executeFile(incrementalMigrationFile);
  await executeFile(incrementalMigrationFile);

  const rows = await db.unsafe<{ table_name: string }[]>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'iam'
      AND table_name = 'login_sessions'
  `);

  expect(rows).toEqual([{ table_name: 'login_sessions' }]);
});
