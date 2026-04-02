import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { channelsSql } from '@/modules/channels/channels.sql';
import type {
  Channel,
  ChannelCallbackConfig,
  ChannelCredential,
  ChannelLimitRule,
  ChannelPricePolicy,
} from '@/modules/channels/channels.types';

export class ChannelsRepository {
  private mapPricePolicy(row: ChannelPricePolicy): ChannelPricePolicy {
    return {
      ...row,
      salePrice: Number(row.salePrice),
    };
  }

  private mapLimitRule(row: ChannelLimitRule): ChannelLimitRule {
    return {
      ...row,
      singleLimit: Number(row.singleLimit),
      dailyLimit: Number(row.dailyLimit),
      monthlyLimit: Number(row.monthlyLimit),
    };
  }

  async listChannels(): Promise<Channel[]> {
    return db.unsafe<Channel[]>(channelsSql.listChannels);
  }

  async createChannel(input: {
    channelCode: string;
    channelName: string;
    channelType: string;
  }): Promise<Channel> {
    const rows = await db<Channel[]>`
      INSERT INTO channel.channels (
        id,
        channel_code,
        channel_name,
        channel_type,
        status,
        settlement_mode,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelCode},
        ${input.channelName},
        ${input.channelType},
        'ACTIVE',
        'PREPAID',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        status,
        settlement_mode AS "settlementMode",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const channel = rows[0];

    if (!channel) {
      throw new Error('创建渠道失败');
    }

    return channel;
  }

  async findChannelById(channelId: string): Promise<Channel | null> {
    return first<Channel>(db<Channel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        status,
        settlement_mode AS "settlementMode",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channels
      WHERE id = ${channelId}
      LIMIT 1
    `);
  }

  async findChannelByCode(channelCode: string): Promise<Channel | null> {
    return first<Channel>(db<Channel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        status,
        settlement_mode AS "settlementMode",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channels
      WHERE channel_code = ${channelCode}
      LIMIT 1
    `);
  }

  async listCredentials(): Promise<ChannelCredential[]> {
    return db.unsafe<ChannelCredential[]>(channelsSql.listCredentials);
  }

  async findCredentialByAccessKey(accessKey: string): Promise<ChannelCredential | null> {
    return first<ChannelCredential>(db<ChannelCredential[]>`
      SELECT
        id,
        channel_id AS "channelId",
        access_key AS "accessKey",
        secret_key_encrypted AS "secretKeyEncrypted",
        sign_algorithm AS "signAlgorithm",
        status,
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channel_api_credentials
      WHERE access_key = ${accessKey}
      LIMIT 1
    `);
  }

  async consumeOpenNonce(input: { accessKey: string; nonce: string; path: string }): Promise<void> {
    await db`
      INSERT INTO channel.channel_request_nonces (
        id,
        access_key,
        nonce,
        request_path,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.accessKey},
        ${input.nonce},
        ${input.path},
        NOW()
      )
    `;
  }

  async upsertCredential(input: {
    channelId: string;
    accessKey: string;
    secretKeyEncrypted: string;
  }): Promise<void> {
    await db`
      INSERT INTO channel.channel_api_credentials (
        id,
        channel_id,
        access_key,
        secret_key_encrypted,
        sign_algorithm,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.accessKey},
        ${input.secretKeyEncrypted},
        'HMAC_SHA256',
        'ACTIVE',
        NOW(),
        NOW()
      )
      ON CONFLICT (access_key) DO UPDATE
      SET
        channel_id = EXCLUDED.channel_id,
        secret_key_encrypted = EXCLUDED.secret_key_encrypted,
        updated_at = NOW()
    `;
  }

  async addAuthorization(input: { channelId: string; productId: string }): Promise<void> {
    await db`
      INSERT INTO channel.channel_product_authorizations (
        id,
        channel_id,
        product_id,
        status,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.productId},
        'ACTIVE',
        NOW()
      )
      ON CONFLICT (channel_id, product_id) DO UPDATE
      SET status = EXCLUDED.status
    `;
  }

  async isAuthorized(channelId: string, productId: string): Promise<boolean> {
    const row = await first<{ count: number }>(db<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM channel.channel_product_authorizations
      WHERE channel_id = ${channelId}
        AND product_id = ${productId}
        AND status = 'ACTIVE'
    `);

    return (row?.count ?? 0) > 0;
  }

  async upsertPricePolicy(input: {
    channelId: string;
    productId: string;
    salePrice: number;
  }): Promise<void> {
    await db`
      INSERT INTO channel.channel_price_policies (
        id,
        channel_id,
        product_id,
        sale_price,
        currency,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.productId},
        ${input.salePrice},
        'CNY',
        'ACTIVE',
        NOW(),
        NOW()
      )
      ON CONFLICT (channel_id, product_id) DO UPDATE
      SET
        sale_price = EXCLUDED.sale_price,
        currency = EXCLUDED.currency,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;
  }

  async findPricePolicy(channelId: string, productId: string): Promise<ChannelPricePolicy | null> {
    const row = await first<ChannelPricePolicy>(db<ChannelPricePolicy[]>`
      SELECT
        id,
        channel_id AS "channelId",
        product_id AS "productId",
        sale_price AS "salePrice",
        currency,
        status,
        effective_from AS "effectiveFrom",
        effective_to AS "effectiveTo"
      FROM channel.channel_price_policies
      WHERE channel_id = ${channelId}
        AND product_id = ${productId}
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return row ? this.mapPricePolicy(row) : null;
  }

  async upsertLimitRule(input: {
    channelId: string;
    singleLimit: number;
    dailyLimit: number;
    monthlyLimit: number;
    qpsLimit: number;
  }): Promise<void> {
    await db`
      INSERT INTO channel.channel_limit_rules (
        id,
        channel_id,
        single_limit,
        daily_limit,
        monthly_limit,
        qps_limit,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.singleLimit},
        ${input.dailyLimit},
        ${input.monthlyLimit},
        ${input.qpsLimit},
        NOW(),
        NOW()
      )
      ON CONFLICT (channel_id) DO UPDATE
      SET
        single_limit = EXCLUDED.single_limit,
        daily_limit = EXCLUDED.daily_limit,
        monthly_limit = EXCLUDED.monthly_limit,
        qps_limit = EXCLUDED.qps_limit,
        updated_at = NOW()
    `;
  }

  async findLimitRule(channelId: string): Promise<ChannelLimitRule | null> {
    const row = await first<ChannelLimitRule>(db<ChannelLimitRule[]>`
      SELECT
        id,
        channel_id AS "channelId",
        single_limit AS "singleLimit",
        daily_limit AS "dailyLimit",
        monthly_limit AS "monthlyLimit",
        qps_limit AS "qpsLimit"
      FROM channel.channel_limit_rules
      WHERE channel_id = ${channelId}
      LIMIT 1
    `);

    return row ? this.mapLimitRule(row) : null;
  }

  async sumOrderAmountToday(channelId: string): Promise<number> {
    const row = await first<{ totalAmount: number }>(db<{ totalAmount: number }[]>`
      SELECT COALESCE(SUM(sale_price), 0)::float8 AS "totalAmount"
      FROM ordering.orders
      WHERE channel_id = ${channelId}
        AND created_at >= date_trunc('day', NOW())
        AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
    `);

    return Number(row?.totalAmount ?? 0);
  }

  async countRecentOpenOrderRequests(channelId: string, seconds: number): Promise<number> {
    const row = await first<{ requestCount: number }>(db<{ requestCount: number }[]>`
      SELECT COUNT(*)::int AS "requestCount"
      FROM channel.channel_request_nonces AS nonce
      INNER JOIN channel.channel_api_credentials AS credential
        ON credential.access_key = nonce.access_key
      WHERE credential.channel_id = ${channelId}
        AND nonce.request_path LIKE '/open-api/orders%'
        AND nonce.created_at >= NOW() - (${seconds} * INTERVAL '1 second')
    `);

    return Number(row?.requestCount ?? 0);
  }

  async upsertCallbackConfig(input: {
    channelId: string;
    callbackUrl: string;
    secretEncrypted: string;
    timeoutSeconds: number;
  }): Promise<void> {
    await db`
      INSERT INTO channel.channel_callback_configs (
        id,
        channel_id,
        callback_url,
        sign_type,
        secret_encrypted,
        retry_enabled,
        timeout_seconds,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.callbackUrl},
        'HMAC_SHA256',
        ${input.secretEncrypted},
        TRUE,
        ${input.timeoutSeconds},
        NOW(),
        NOW()
      )
      ON CONFLICT (channel_id) DO UPDATE
      SET
        callback_url = EXCLUDED.callback_url,
        secret_encrypted = EXCLUDED.secret_encrypted,
        timeout_seconds = EXCLUDED.timeout_seconds,
        updated_at = NOW()
    `;
  }

  async findCallbackConfig(channelId: string): Promise<ChannelCallbackConfig | null> {
    return first<ChannelCallbackConfig>(db<ChannelCallbackConfig[]>`
      SELECT
        id,
        channel_id AS "channelId",
        callback_url AS "callbackUrl",
        sign_type AS "signType",
        secret_encrypted AS "secretEncrypted",
        retry_enabled AS "retryEnabled",
        timeout_seconds AS "timeoutSeconds",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channel_callback_configs
      WHERE channel_id = ${channelId}
      LIMIT 1
    `);
  }
}
