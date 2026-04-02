import type { SQL } from 'bun';

import { env } from '@/lib/env';
import { encryptText, hashPassword } from '@/lib/security';

const seedIds = {
  adminUser: 'seed-admin-user',
  superAdminRole: 'seed-role-super-admin',
  demoChannel: 'seed-channel-demo',
  demoCredential: 'seed-channel-credential-demo',
  demoCallback: 'seed-channel-callback-demo',
  demoLimitRule: 'seed-channel-limit-demo',
  mockSupplier: 'seed-supplier-mock',
  mockSupplierConfig: 'seed-supplier-config-mock',
  mixedProduct: 'seed-product-cmcc-mixed-50',
  fastProduct: 'seed-product-cmcc-fast-100',
  mixedMapping: 'seed-product-mapping-mixed',
  fastMapping: 'seed-product-mapping-fast',
  mobileSegment: 'seed-mobile-segment-1380013',
  mixedAuthorization: 'seed-channel-auth-mixed',
  fastAuthorization: 'seed-channel-auth-fast',
  mixedPrice: 'seed-channel-price-mixed',
  fastPrice: 'seed-channel-price-fast',
  platformAccount: 'seed-ledger-account-platform',
  channelAccount: 'seed-ledger-account-channel',
  supplierAccount: 'seed-ledger-account-supplier',
} as const;

export async function runSeed(db: SQL): Promise<void> {
  const passwordHash = await hashPassword(env.seed.adminPassword);
  const channelSecret = encryptText(env.seed.secretKey);
  const callbackSecret = encryptText('demo-callback-secret');
  const supplierCredential = encryptText('mock-supplier-token');
  const supplierCallbackSecret = encryptText('mock-supplier-callback');

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
        updated_at = NOW()
    `;

    await tx`
      INSERT INTO iam.roles (id, role_code, role_name, status)
      VALUES (
        ${seedIds.superAdminRole},
        'SUPER_ADMIN',
        '超级管理员',
        'ACTIVE'
      )
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

    await tx`
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
          ${seedIds.mixedProduct},
          'cmcc-mixed-50',
          '广东移动慢充 50 元',
          'CMCC',
          '广东',
          50,
          'MIXED',
          'CNY',
          'ACTIVE'
        ),
        (
          ${seedIds.fastProduct},
          'cmcc-fast-100',
          '广东移动快充 100 元',
          'CMCC',
          '广东',
          100,
          'FAST',
          'CNY',
          'ACTIVE'
        )
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
    `;

    await tx`
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
        (
          ${seedIds.mixedMapping},
          ${seedIds.mixedProduct},
          ${seedIds.mockSupplier},
          'mock-cmcc-mixed-50',
          'PRIMARY',
          1,
          48,
          'ON_SALE',
          100,
          NOW(),
          'ACTIVE'
        ),
        (
          ${seedIds.fastMapping},
          ${seedIds.fastProduct},
          ${seedIds.mockSupplier},
          'mock-cmcc-fast-100',
          'PRIMARY',
          1,
          96,
          'ON_SALE',
          100,
          NOW(),
          'ACTIVE'
        )
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
    `;

    await tx`
      INSERT INTO channel.channel_product_authorizations (
        id,
        channel_id,
        product_id,
        status
      )
      VALUES
        (${seedIds.mixedAuthorization}, ${seedIds.demoChannel}, ${seedIds.mixedProduct}, 'ACTIVE'),
        (${seedIds.fastAuthorization}, ${seedIds.demoChannel}, ${seedIds.fastProduct}, 'ACTIVE')
      ON CONFLICT (channel_id, product_id) DO UPDATE
      SET status = EXCLUDED.status
    `;

    await tx`
      INSERT INTO channel.channel_price_policies (
        id,
        channel_id,
        product_id,
        sale_price,
        currency,
        status
      )
      VALUES
        (${seedIds.mixedPrice}, ${seedIds.demoChannel}, ${seedIds.mixedProduct}, 50, 'CNY', 'ACTIVE'),
        (${seedIds.fastPrice}, ${seedIds.demoChannel}, ${seedIds.fastProduct}, 100, 'CNY', 'ACTIVE')
      ON CONFLICT (channel_id, product_id) DO UPDATE
      SET
        sale_price = EXCLUDED.sale_price,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;

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
