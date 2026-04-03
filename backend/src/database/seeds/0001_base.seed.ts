import type { SQL } from 'bun';

import { env } from '@/lib/env';
import { encryptText, hashPassword } from '@/lib/security';
import type { RechargeProductType } from '@/modules/products/products.types';

export const fixedRechargeCarriers = [
  { carrierCode: 'CMCC', carrierName: '中国移动', displayName: '移动', carrierSlug: 'cmcc' },
  { carrierCode: 'CTCC', carrierName: '中国电信', displayName: '电信', carrierSlug: 'ctcc' },
  { carrierCode: 'CUCC', carrierName: '中国联通', displayName: '联通', carrierSlug: 'cucc' },
  { carrierCode: 'CBN', carrierName: '中国广电', displayName: '广电', carrierSlug: 'cbn' },
] as const;

export const fixedRechargeRegions = [
  { provinceName: '北京', provinceCode: 'beijing' },
  { provinceName: '天津', provinceCode: 'tianjin' },
  { provinceName: '河北', provinceCode: 'hebei' },
  { provinceName: '山西', provinceCode: 'shanxi' },
  { provinceName: '内蒙古', provinceCode: 'neimenggu' },
  { provinceName: '辽宁', provinceCode: 'liaoning' },
  { provinceName: '吉林', provinceCode: 'jilin' },
  { provinceName: '黑龙江', provinceCode: 'heilongjiang' },
  { provinceName: '上海', provinceCode: 'shanghai' },
  { provinceName: '江苏', provinceCode: 'jiangsu' },
  { provinceName: '浙江', provinceCode: 'zhejiang' },
  { provinceName: '安徽', provinceCode: 'anhui' },
  { provinceName: '福建', provinceCode: 'fujian' },
  { provinceName: '江西', provinceCode: 'jiangxi' },
  { provinceName: '山东', provinceCode: 'shandong' },
  { provinceName: '河南', provinceCode: 'henan' },
  { provinceName: '湖北', provinceCode: 'hubei' },
  { provinceName: '湖南', provinceCode: 'hunan' },
  { provinceName: '广东', provinceCode: 'guangdong' },
  { provinceName: '广西', provinceCode: 'guangxi' },
  { provinceName: '海南', provinceCode: 'hainan' },
  { provinceName: '重庆', provinceCode: 'chongqing' },
  { provinceName: '四川', provinceCode: 'sichuan' },
  { provinceName: '贵州', provinceCode: 'guizhou' },
  { provinceName: '云南', provinceCode: 'yunnan' },
  { provinceName: '西藏', provinceCode: 'xizang' },
  { provinceName: '陕西', provinceCode: 'shaanxi' },
  { provinceName: '甘肃', provinceCode: 'gansu' },
  { provinceName: '青海', provinceCode: 'qinghai' },
  { provinceName: '宁夏', provinceCode: 'ningxia' },
  { provinceName: '新疆', provinceCode: 'xinjiang' },
] as const;

export const fixedRechargeFaceValues = [10, 30, 50, 100, 200] as const;
export const fixedRechargeModes = [
  'FAST',
  'MIXED',
] as const satisfies readonly RechargeProductType[];
export const FIXED_RECHARGE_PRODUCT_COUNT =
  fixedRechargeCarriers.length *
  fixedRechargeRegions.length *
  fixedRechargeFaceValues.length *
  fixedRechargeModes.length;

type FixedCarrierCode = (typeof fixedRechargeCarriers)[number]['carrierCode'];
type FixedProvinceName = (typeof fixedRechargeRegions)[number]['provinceName'];

function getCarrierSeedMeta(carrierCode: FixedCarrierCode) {
  const carrier = fixedRechargeCarriers.find((item) => item.carrierCode === carrierCode);

  if (!carrier) {
    throw new Error(`未支持的运营商编码: ${carrierCode}`);
  }

  return carrier;
}

function getRegionSeedMeta(provinceName: FixedProvinceName) {
  const region = fixedRechargeRegions.find((item) => item.provinceName === provinceName);

  if (!region) {
    throw new Error(`未支持的地区: ${provinceName}`);
  }

  return region;
}

function buildSeedKey(input: {
  carrierCode: FixedCarrierCode;
  provinceName: FixedProvinceName;
  productType: RechargeProductType;
  faceValue: number;
}) {
  const carrier = getCarrierSeedMeta(input.carrierCode);
  const region = getRegionSeedMeta(input.provinceName);

  return `${carrier.carrierSlug}-${region.provinceCode}-${input.productType.toLowerCase()}-${input.faceValue}`;
}

export function buildSeedRechargeProductId(input: {
  carrierCode: FixedCarrierCode;
  provinceName: FixedProvinceName;
  productType: RechargeProductType;
  faceValue: number;
}) {
  return `seed-product-${buildSeedKey(input)}`;
}

export function buildSeedRechargeProductCode(input: {
  carrierCode: FixedCarrierCode;
  provinceName: FixedProvinceName;
  productType: RechargeProductType;
  faceValue: number;
}) {
  return buildSeedKey(input);
}

export function buildSeedMockSupplierProductCode(input: {
  carrierCode: FixedCarrierCode;
  provinceName: FixedProvinceName;
  productType: RechargeProductType;
  faceValue: number;
}) {
  return `mock-${buildSeedKey(input)}`;
}

function buildSeedRechargeProductName(input: {
  carrierCode: FixedCarrierCode;
  provinceName: FixedProvinceName;
  productType: RechargeProductType;
  faceValue: number;
}) {
  const carrier = getCarrierSeedMeta(input.carrierCode);
  const productTypeName = input.productType === 'FAST' ? '快充' : '混充';

  return `${input.provinceName}${carrier.displayName}话费 ${input.faceValue} 元${productTypeName}`;
}

function sqlLiteral(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`SQL 数值非法: ${value}`);
    }

    return String(value);
  }

  return `'${value.replaceAll("'", "''")}'`;
}

const seedIds = {
  adminUser: 'seed-admin-user',
  superAdminRole: 'seed-role-super-admin',
  opsRole: 'seed-role-ops',
  financeRole: 'seed-role-finance',
  riskRole: 'seed-role-risk',
  supportRole: 'seed-role-support',
  demoChannel: 'seed-channel-demo',
  demoCredential: 'seed-channel-credential-demo',
  demoCallback: 'seed-channel-callback-demo',
  demoLimitRule: 'seed-channel-limit-demo',
  mockSupplier: 'seed-supplier-mock',
  mockSupplierConfig: 'seed-supplier-config-mock',
  shenzhenKefeiSupplier: 'seed-supplier-shenzhen-kefei',
  shenzhenKefeiSupplierConfig: 'seed-supplier-config-shenzhen-kefei',
  mobileSegment: 'seed-mobile-segment-1380013',
  platformAccount: 'seed-ledger-account-platform',
  channelAccount: 'seed-ledger-account-channel',
  supplierAccount: 'seed-ledger-account-supplier',
} as const;

async function seedFixedRechargeCatalog(tx: SQL): Promise<void> {
  const products = fixedRechargeCarriers.flatMap((carrier) =>
    fixedRechargeRegions.flatMap((region) =>
      fixedRechargeFaceValues.flatMap((faceValue) =>
        fixedRechargeModes.map((productType) => ({
          id: buildSeedRechargeProductId({
            carrierCode: carrier.carrierCode,
            provinceName: region.provinceName,
            productType,
            faceValue,
          }),
          productCode: buildSeedRechargeProductCode({
            carrierCode: carrier.carrierCode,
            provinceName: region.provinceName,
            productType,
            faceValue,
          }),
          productName: buildSeedRechargeProductName({
            carrierCode: carrier.carrierCode,
            provinceName: region.provinceName,
            productType,
            faceValue,
          }),
          carrierCode: carrier.carrierCode,
          provinceName: region.provinceName,
          faceValue,
          productType,
          supplierProductCode: buildSeedMockSupplierProductCode({
            carrierCode: carrier.carrierCode,
            provinceName: region.provinceName,
            productType,
            faceValue,
          }),
          costPrice: Number((faceValue * 0.96).toFixed(2)),
        })),
      ),
    ),
  );

  await tx.unsafe(`
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
      ${products
        .map(
          (product) =>
            `(${sqlLiteral(product.id)}, ${sqlLiteral(product.productCode)}, ${sqlLiteral(
              product.productName,
            )}, ${sqlLiteral(product.carrierCode)}, ${sqlLiteral(product.provinceName)}, ${sqlLiteral(
              product.faceValue,
            )}, ${sqlLiteral(product.productType)}, 'CNY', 'ACTIVE')`,
        )
        .join(',\n      ')}
    ON CONFLICT (product_code) DO UPDATE
    SET
      product_name = EXCLUDED.product_name,
      carrier_code = EXCLUDED.carrier_code,
      province_name = EXCLUDED.province_name,
      face_value = EXCLUDED.face_value,
      recharge_mode = EXCLUDED.recharge_mode,
      sales_unit = EXCLUDED.sales_unit,
      status = EXCLUDED.status,
      updated_at = NOW()
  `);

  await tx.unsafe(`
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
    VALUES
      ${products
        .map(
          (product) =>
            `(${sqlLiteral(`seed-product-mapping-${product.productCode}`)}, ${sqlLiteral(
              product.id,
            )}, ${sqlLiteral(seedIds.mockSupplier)}, ${sqlLiteral(
              product.supplierProductCode,
            )}, 'PRIMARY', 1, ${sqlLiteral(product.costPrice)}, 'ON_SALE', 100, NOW(), 'ACTIVE')`,
        )
        .join(',\n      ')}
    ON CONFLICT (product_id, supplier_id) DO UPDATE
    SET
      supplier_product_code = EXCLUDED.supplier_product_code,
      route_type = EXCLUDED.route_type,
      priority = EXCLUDED.priority,
      cost_price = EXCLUDED.cost_price,
      sales_status = EXCLUDED.sales_status,
      inventory_quantity = EXCLUDED.inventory_quantity,
      dynamic_updated_at = EXCLUDED.dynamic_updated_at,
      status = EXCLUDED.status,
      updated_at = NOW()
  `);

  await tx.unsafe(`
    INSERT INTO channel.channel_product_authorizations (
      id,
      channel_id,
      product_id,
      status
    )
    VALUES
      ${products
        .map(
          (product) =>
            `(${sqlLiteral(`seed-channel-auth-${product.productCode}`)}, ${sqlLiteral(
              seedIds.demoChannel,
            )}, ${sqlLiteral(product.id)}, 'ACTIVE')`,
        )
        .join(',\n      ')}
    ON CONFLICT (channel_id, product_id) DO UPDATE
    SET status = EXCLUDED.status
  `);

  await tx.unsafe(`
    INSERT INTO channel.channel_price_policies (
      id,
      channel_id,
      product_id,
      sale_price,
      currency,
      status
    )
    VALUES
      ${products
        .map(
          (product) =>
            `(${sqlLiteral(`seed-channel-price-${product.productCode}`)}, ${sqlLiteral(
              seedIds.demoChannel,
            )}, ${sqlLiteral(product.id)}, ${sqlLiteral(product.faceValue)}, 'CNY', 'ACTIVE')`,
        )
        .join(',\n      ')}
    ON CONFLICT (channel_id, product_id) DO UPDATE
    SET
      sale_price = EXCLUDED.sale_price,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      updated_at = NOW()
  `);
}

export async function runSeed(db: SQL): Promise<void> {
  const passwordHash = await hashPassword(env.seed.adminPassword);
  const channelSecret = encryptText(env.seed.secretKey);
  const callbackSecret = encryptText('demo-callback-secret');
  const supplierCredential = encryptText('mock-supplier-token');
  const supplierCallbackSecret = encryptText('mock-supplier-callback');
  const shenzhenKefeiCredential = encryptText(
    JSON.stringify({
      agentAccount: 'JG18948358181',
      md5Key: 'F29C80BB80EA32D4',
      baseUrl: 'http://api.sohan.hk:50080/API',
    }),
  );
  const shenzhenKefeiCallbackSecret = encryptText('F29C80BB80EA32D4');

  await db.begin(async (tx) => {
    await tx`
      INSERT INTO iam.admin_users (
        id,
        username,
        password_hash,
        display_name,
        status
      )
      VALUES (
        ${seedIds.adminUser},
        ${env.seed.adminUsername},
        ${passwordHash},
        ${env.seed.adminDisplayName},
        'ACTIVE'
      )
      ON CONFLICT (username) DO UPDATE
      SET
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        status = EXCLUDED.status,
        failed_login_attempts = 0,
        locked_until = NULL,
        last_login_at = NULL,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO iam.roles (id, role_code, role_name, status)
      VALUES
        (${seedIds.superAdminRole}, 'SUPER_ADMIN', '超级管理员', 'ACTIVE'),
        (${seedIds.opsRole}, 'OPS', '平台运营', 'ACTIVE'),
        (${seedIds.financeRole}, 'FINANCE', '平台财务', 'ACTIVE'),
        (${seedIds.riskRole}, 'RISK', '风控专员', 'ACTIVE'),
        (${seedIds.supportRole}, 'SUPPORT', '技术支持', 'ACTIVE')
      ON CONFLICT (role_code) DO UPDATE
      SET
        role_name = EXCLUDED.role_name,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO iam.user_role_relations (user_id, role_id)
      VALUES (${seedIds.adminUser}, ${seedIds.superAdminRole})
      ON CONFLICT (user_id, role_id) DO NOTHING
    `;

    await tx`
      INSERT INTO channel.channels (
        id,
        channel_code,
        channel_name,
        channel_type,
        status,
        settlement_mode
      )
      VALUES (
        ${seedIds.demoChannel},
        ${env.seed.channelCode},
        '演示渠道',
        'API',
        'ACTIVE',
        'PREPAID'
      )
      ON CONFLICT (channel_code) DO UPDATE
      SET
        channel_name = EXCLUDED.channel_name,
        channel_type = EXCLUDED.channel_type,
        status = EXCLUDED.status,
        settlement_mode = EXCLUDED.settlement_mode,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_api_credentials (
        id,
        channel_id,
        access_key,
        secret_key_encrypted,
        sign_algorithm,
        status
      )
      VALUES (
        ${seedIds.demoCredential},
        ${seedIds.demoChannel},
        ${env.seed.accessKey},
        ${channelSecret},
        'HMAC_SHA256',
        'ACTIVE'
      )
      ON CONFLICT (access_key) DO UPDATE
      SET
        channel_id = EXCLUDED.channel_id,
        secret_key_encrypted = EXCLUDED.secret_key_encrypted,
        sign_algorithm = EXCLUDED.sign_algorithm,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_callback_configs (
        id,
        channel_id,
        callback_url,
        sign_type,
        secret_encrypted,
        retry_enabled,
        timeout_seconds
      )
      VALUES (
        ${seedIds.demoCallback},
        ${seedIds.demoChannel},
        'mock://success',
        'HMAC_SHA256',
        ${callbackSecret},
        TRUE,
        5
      )
      ON CONFLICT (channel_id) DO UPDATE
      SET
        callback_url = EXCLUDED.callback_url,
        sign_type = EXCLUDED.sign_type,
        secret_encrypted = EXCLUDED.secret_encrypted,
        retry_enabled = EXCLUDED.retry_enabled,
        timeout_seconds = EXCLUDED.timeout_seconds,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO channel.channel_limit_rules (
        id,
        channel_id,
        single_limit,
        daily_limit,
        monthly_limit,
        qps_limit
      )
      VALUES (
        ${seedIds.demoLimitRule},
        ${seedIds.demoChannel},
        1000,
        10000,
        100000,
        100
      )
      ON CONFLICT (channel_id) DO UPDATE
      SET
        single_limit = EXCLUDED.single_limit,
        daily_limit = EXCLUDED.daily_limit,
        monthly_limit = EXCLUDED.monthly_limit,
        qps_limit = EXCLUDED.qps_limit,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        protocol_type,
        status
      )
      VALUES (
        ${seedIds.mockSupplier},
        ${env.seed.supplierCode},
        '模拟供应商',
        'MOCK',
        'ACTIVE'
      )
      ON CONFLICT (supplier_code) DO UPDATE
      SET
        supplier_name = EXCLUDED.supplier_name,
        protocol_type = EXCLUDED.protocol_type,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms
      )
      VALUES (
        ${seedIds.mockSupplierConfig},
        ${seedIds.mockSupplier},
        ${JSON.stringify({ mode: 'mock-auto-success' })},
        ${supplierCredential},
        ${supplierCallbackSecret},
        2000
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        protocol_type,
        status
      )
      VALUES (
        ${seedIds.shenzhenKefeiSupplier},
        'shenzhen-kefei',
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

    await tx`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms
      )
      VALUES (
        ${seedIds.shenzhenKefeiSupplierConfig},
        ${seedIds.shenzhenKefeiSupplier},
        ${JSON.stringify({
          baseUrl: 'http://api.sohan.hk:50080/API',
        })},
        ${shenzhenKefeiCredential},
        ${shenzhenKefeiCallbackSecret},
        3000
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO product.mobile_segments (
        id,
        mobile_prefix,
        province_name,
        city_name,
        isp_code,
        isp_name
      )
      VALUES (
        ${seedIds.mobileSegment},
        '1380013',
        '广东',
        '广州',
        'CMCC',
        '中国移动'
      )
      ON CONFLICT (mobile_prefix) DO UPDATE
      SET
        province_name = EXCLUDED.province_name,
        city_name = EXCLUDED.city_name,
        isp_code = EXCLUDED.isp_code,
        isp_name = EXCLUDED.isp_name,
        updated_at = NOW()
    `;

    await seedFixedRechargeCatalog(tx);

    await tx`
      INSERT INTO ledger.accounts (
        id,
        owner_type,
        owner_id,
        available_balance,
        frozen_balance,
        currency,
        status
      )
      VALUES
        (${seedIds.platformAccount}, 'PLATFORM', 'SYSTEM', 0, 0, 'CNY', 'ACTIVE'),
        (${seedIds.channelAccount}, 'CHANNEL', ${seedIds.demoChannel}, 10000, 0, 'CNY', 'ACTIVE'),
        (${seedIds.supplierAccount}, 'SUPPLIER', ${seedIds.mockSupplier}, 0, 0, 'CNY', 'ACTIVE')
      ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
      SET
        available_balance = EXCLUDED.available_balance,
        frozen_balance = EXCLUDED.frozen_balance,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;
  });
}
