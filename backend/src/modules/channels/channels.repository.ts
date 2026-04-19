import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import type {
  Channel,
  ChannelBalanceRecord,
  ChannelCallbackConfig,
  ChannelCredential,
  ChannelLimitRule,
  ChannelPortalSession,
  ChannelPricePolicy,
  ChannelProductRecord,
  ChannelRechargeRecord,
  ChannelSplitPolicy,
} from '@/modules/channels/channels.types';

function normalizeOrderDirection(sortOrder?: 'asc' | 'desc') {
  return sortOrder === 'asc' ? 'ASC' : 'DESC';
}

export class ChannelsRepository {
  private mapChannel(row: Channel): Channel {
    return {
      ...row,
      failedLoginAttempts: Number(row.failedLoginAttempts ?? 0),
      supportsConsumptionLog: Boolean(row.supportsConsumptionLog),
    };
  }

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

  private mapSplitPolicy(row: ChannelSplitPolicy & { allowedFaceValues?: unknown }): ChannelSplitPolicy {
    return {
      ...row,
      allowedFaceValues: parseJsonValue<number[]>(row.allowedFaceValues, []),
    };
  }

  private mapRechargeRecord(
    row: ChannelRechargeRecord & { amount: number | string; beforeBalance: number | string; afterBalance: number | string },
  ): ChannelRechargeRecord {
    return {
      ...row,
      amount: Number(row.amount),
      beforeBalance: Number(row.beforeBalance),
      afterBalance: Number(row.afterBalance),
    };
  }

  private mapProduct(row: ChannelProductRecord): ChannelProductRecord {
    return {
      ...row,
      faceValue: Number(row.faceValue),
      salePrice: row.salePrice === null ? null : Number(row.salePrice),
      routeCostPrice:
        row.routeCostPrice === null || row.routeCostPrice === undefined
          ? null
          : Number(row.routeCostPrice),
      authorized: Boolean(row.authorized),
    };
  }

  async listChannels(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    cooperationStatus?: string;
    protocolType?: string;
    channelType?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: Channel[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      channelCode: 'channel_code',
      channelName: 'channel_name',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = normalizeOrderDirection(input.sortOrder);

    if (input.keyword?.trim()) {
      params.push(`%${input.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(
        `(channel_code ILIKE $${index} OR channel_name ILIKE $${index} OR COALESCE(access_account, '') ILIKE $${index})`,
      );
    }

    const equalityConditions: Array<[string, string | undefined]> = [
      ['status', input.status],
      ['cooperation_status', input.cooperationStatus],
      ['protocol_type', input.protocolType],
      ['channel_type', input.channelType],
    ];

    for (const [column, value] of equalityConditions) {
      if (!value?.trim()) {
        continue;
      }

      params.push(value.trim());
      whereClauses.push(`${column} = $${params.length}`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const rows = await db.unsafe<Channel[]>(
      `
        SELECT
          id,
          channel_code AS "channelCode",
          channel_name AS "channelName",
          channel_type AS "channelType",
          contact_name AS "contactName",
          contact_phone AS "contactPhone",
          contact_email AS "contactEmail",
          base_url AS "baseUrl",
          protocol_type AS "protocolType",
          access_account AS "accessAccount",
          access_password_hash AS "accessPasswordHash",
          failed_login_attempts AS "failedLoginAttempts",
          locked_until AS "lockedUntil",
          cooperation_status AS "cooperationStatus",
          supports_consumption_log AS "supportsConsumptionLog",
          settlement_mode AS "settlementMode",
          status,
          remark,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM channel.channels
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM channel.channels
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => this.mapChannel(row)),
      total: total?.total ?? 0,
    };
  }

  async createChannel(input: {
    channelCode: string;
    channelName: string;
    channelType: string;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    baseUrl?: string | null;
    protocolType: string;
    accessAccount?: string | null;
    accessPasswordHash?: string | null;
    cooperationStatus: string;
    supportsConsumptionLog: boolean;
    settlementMode: string;
    status: string;
    remark?: string | null;
  }): Promise<Channel> {
    const rows = await db<Channel[]>`
      INSERT INTO channel.channels (
        id,
        channel_code,
        channel_name,
        channel_type,
        contact_name,
        contact_phone,
        contact_email,
        base_url,
        protocol_type,
        access_account,
        access_password_hash,
        cooperation_status,
        supports_consumption_log,
        settlement_mode,
        status,
        remark,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelCode},
        ${input.channelName},
        ${input.channelType},
        ${input.contactName ?? null},
        ${input.contactPhone ?? null},
        ${input.contactEmail ?? null},
        ${input.baseUrl ?? null},
        ${input.protocolType},
        ${input.accessAccount ?? null},
        ${input.accessPasswordHash ?? null},
        ${input.cooperationStatus},
        ${input.supportsConsumptionLog},
        ${input.settlementMode},
        ${input.status},
        ${input.remark ?? null},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        access_account AS "accessAccount",
        access_password_hash AS "accessPasswordHash",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        cooperation_status AS "cooperationStatus",
        supports_consumption_log AS "supportsConsumptionLog",
        settlement_mode AS "settlementMode",
        status,
        remark,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const channel = rows[0];

    if (!channel) {
      throw new Error('创建渠道失败');
    }

    return this.mapChannel(channel);
  }

  async updateChannel(
    channelId: string,
    input: {
      channelName: string;
      channelType: string;
      contactName?: string | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
      baseUrl?: string | null;
      protocolType: string;
      accessAccount?: string | null;
      accessPasswordHash?: string | null;
      cooperationStatus: string;
      supportsConsumptionLog: boolean;
      settlementMode: string;
      status: string;
      remark?: string | null;
    },
  ): Promise<Channel | null> {
    const rows = await db<Channel[]>`
      UPDATE channel.channels
      SET
        channel_name = ${input.channelName},
        channel_type = ${input.channelType},
        contact_name = ${input.contactName ?? null},
        contact_phone = ${input.contactPhone ?? null},
        contact_email = ${input.contactEmail ?? null},
        base_url = ${input.baseUrl ?? null},
        protocol_type = ${input.protocolType},
        access_account = ${input.accessAccount ?? null},
        access_password_hash = COALESCE(${input.accessPasswordHash ?? null}, access_password_hash),
        cooperation_status = ${input.cooperationStatus},
        supports_consumption_log = ${input.supportsConsumptionLog},
        settlement_mode = ${input.settlementMode},
        status = ${input.status},
        remark = ${input.remark ?? null},
        updated_at = NOW()
      WHERE id = ${channelId}
      RETURNING
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        access_account AS "accessAccount",
        access_password_hash AS "accessPasswordHash",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        cooperation_status AS "cooperationStatus",
        supports_consumption_log AS "supportsConsumptionLog",
        settlement_mode AS "settlementMode",
        status,
        remark,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const channel = rows[0];
    return channel ? this.mapChannel(channel) : null;
  }

  async findChannelById(channelId: string): Promise<Channel | null> {
    const row = await first<Channel>(db<Channel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        access_account AS "accessAccount",
        access_password_hash AS "accessPasswordHash",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        cooperation_status AS "cooperationStatus",
        supports_consumption_log AS "supportsConsumptionLog",
        settlement_mode AS "settlementMode",
        status,
        remark,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channels
      WHERE id = ${channelId}
      LIMIT 1
    `);

    return row ? this.mapChannel(row) : null;
  }

  async findChannelByCode(channelCode: string): Promise<Channel | null> {
    const row = await first<Channel>(db<Channel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        access_account AS "accessAccount",
        access_password_hash AS "accessPasswordHash",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        cooperation_status AS "cooperationStatus",
        supports_consumption_log AS "supportsConsumptionLog",
        settlement_mode AS "settlementMode",
        status,
        remark,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channels
      WHERE channel_code = ${channelCode}
      LIMIT 1
    `);

    return row ? this.mapChannel(row) : null;
  }

  async findChannelByAccessAccount(accessAccount: string): Promise<Channel | null> {
    const row = await first<Channel>(db<Channel[]>`
      SELECT
        id,
        channel_code AS "channelCode",
        channel_name AS "channelName",
        channel_type AS "channelType",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        access_account AS "accessAccount",
        access_password_hash AS "accessPasswordHash",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        cooperation_status AS "cooperationStatus",
        supports_consumption_log AS "supportsConsumptionLog",
        settlement_mode AS "settlementMode",
        status,
        remark,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channels
      WHERE access_account = ${accessAccount}
      LIMIT 1
    `);

    return row ? this.mapChannel(row) : null;
  }

  async recordPortalLoginAttempt(input: {
    channelId: string | null;
    username: string;
    ip: string;
    deviceSummary: string;
    result: string;
    failureReason: string | null;
  }): Promise<void> {
    await db`
      INSERT INTO channel.portal_login_logs (
        id,
        channel_id,
        username,
        ip,
        device_summary,
        result,
        failure_reason,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.username},
        ${input.ip},
        ${input.deviceSummary},
        ${input.result},
        ${input.failureReason},
        NOW()
      )
    `;
  }

  async recordFailedPortalPasswordAttempt(
    channelId: string,
    threshold: number,
    lockMinutes: number,
  ): Promise<{ failedLoginAttempts: number; lockedUntil: string | null }> {
    const rows = await db<{ failedLoginAttempts: number; lockedUntil: string | null }[]>`
      UPDATE channel.channels
      SET
        failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE
          WHEN failed_login_attempts + 1 >= ${threshold}
            THEN NOW() + (${lockMinutes} || ' minutes')::interval
          ELSE locked_until
        END,
        updated_at = NOW()
      WHERE id = ${channelId}
      RETURNING
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil"
    `;

    return rows[0] ?? { failedLoginAttempts: 0, lockedUntil: null };
  }

  async clearPortalLoginFailures(channelId: string): Promise<void> {
    await db`
      UPDATE channel.channels
      SET
        failed_login_attempts = 0,
        locked_until = NULL,
        updated_at = NOW()
      WHERE id = ${channelId}
    `;
  }

  async createPortalSession(input: {
    channelId: string;
    accessTokenHash: string;
    expiresAt: Date;
  }): Promise<ChannelPortalSession> {
    const rows = await db<ChannelPortalSession[]>`
      INSERT INTO channel.portal_login_sessions (
        id,
        channel_id,
        access_token_hash,
        status,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.accessTokenHash},
        'ACTIVE',
        ${input.expiresAt},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        channel_id AS "channelId",
        access_token_hash AS "accessTokenHash",
        status,
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const session = rows[0];

    if (!session) {
      throw new Error('创建门户会话失败');
    }

    return session;
  }

  async findActivePortalSessionByHash(accessTokenHash: string): Promise<ChannelPortalSession | null> {
    return first<ChannelPortalSession>(db<ChannelPortalSession[]>`
      SELECT
        id,
        channel_id AS "channelId",
        access_token_hash AS "accessTokenHash",
        status,
        expires_at AS "expiresAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.portal_login_sessions
      WHERE access_token_hash = ${accessTokenHash}
        AND status = 'ACTIVE'
        AND expires_at > NOW()
      LIMIT 1
    `);
  }

  async revokePortalSessionByHash(accessTokenHash: string): Promise<void> {
    await db`
      UPDATE channel.portal_login_sessions
      SET
        status = 'REVOKED',
        updated_at = NOW()
      WHERE access_token_hash = ${accessTokenHash}
    `;
  }

  async listCredentials(): Promise<ChannelCredential[]> {
    return db<ChannelCredential[]>`
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
      ORDER BY created_at DESC, id DESC
    `;
  }

  async listCredentialsByChannelId(channelId: string): Promise<ChannelCredential[]> {
    return db<ChannelCredential[]>`
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
      WHERE channel_id = ${channelId}
      ORDER BY created_at DESC, id DESC
    `;
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
        sign_algorithm = EXCLUDED.sign_algorithm,
        status = 'ACTIVE',
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
      SET
        status = 'ACTIVE'
    `;
  }

  async isAuthorized(channelId: string, productId: string): Promise<boolean> {
    const row = await first<{ exists: boolean }>(db<{ exists: boolean }[]>`
      SELECT TRUE AS exists
      FROM channel.channel_product_authorizations
      WHERE channel_id = ${channelId}
        AND product_id = ${productId}
        AND status = 'ACTIVE'
      LIMIT 1
    `);

    return Boolean(row?.exists);
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
        status = 'ACTIVE',
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
    const row = await first<{ total: number | string }>(db<{ total: number | string }[]>`
      SELECT COALESCE(SUM(total_sale_price), 0) AS total
      FROM ordering.order_groups
      WHERE channel_id = ${channelId}
        AND created_at >= date_trunc('day', NOW())
    `);

    return Number(row?.total ?? 0);
  }

  async countRecentOpenOrderRequests(channelId: string, seconds: number): Promise<number> {
    const row = await first<{ total: number }>(db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM channel.channel_request_nonces AS nonce
      INNER JOIN channel.channel_api_credentials AS credential
        ON credential.access_key = nonce.access_key
      WHERE credential.channel_id = ${channelId}
        AND nonce.request_path LIKE '/open-api/orders%'
        AND nonce.created_at >= NOW() - (${seconds} || ' seconds')::interval
    `);

    return row?.total ?? 0;
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
        sign_type = EXCLUDED.sign_type,
        secret_encrypted = EXCLUDED.secret_encrypted,
        retry_enabled = EXCLUDED.retry_enabled,
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

  async listAuthorizationsByChannelId(channelId: string): Promise<string[]> {
    const rows = await db<{ productId: string }[]>`
      SELECT product_id AS "productId"
      FROM channel.channel_product_authorizations
      WHERE channel_id = ${channelId}
        AND status = 'ACTIVE'
      ORDER BY created_at ASC
    `;

    return rows.map((row) => row.productId);
  }

  async listPricePoliciesByChannelId(channelId: string): Promise<ChannelPricePolicy[]> {
    const rows = await db<ChannelPricePolicy[]>`
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
      ORDER BY created_at DESC, id DESC
    `;

    return rows.map((row) => this.mapPricePolicy(row));
  }

  async listChannelProducts(input: {
    channelId: string;
    carrierCode?: string;
    province?: string;
    faceValue?: number;
    productType?: string;
    status?: string;
  }): Promise<ChannelProductRecord[]> {
    const effectiveStatusSql = `CASE
      WHEN product.status = 'ACTIVE'
        AND authz.status = 'ACTIVE'
        AND COALESCE(price.status, 'ACTIVE') = 'ACTIVE'
      THEN 'ACTIVE'
      ELSE 'INACTIVE'
    END`;
    const params: unknown[] = [input.channelId];
    const whereClauses = ['authz.channel_id = $1'];

    if (input.carrierCode) {
      params.push(input.carrierCode);
      whereClauses.push(`product.carrier_code = $${params.length}`);
    }

    if (input.province) {
      params.push(input.province);
      whereClauses.push(`product.province_name = $${params.length}`);
    }

    if (input.faceValue !== undefined) {
      params.push(input.faceValue);
      whereClauses.push(`product.face_value = $${params.length}`);
    }

    if (input.productType) {
      params.push(input.productType);
      whereClauses.push(`product.recharge_mode = $${params.length}`);
    }

    if (input.status) {
      params.push(input.status);
      whereClauses.push(`${effectiveStatusSql} = $${params.length}`);
    }

    const rows = await db.unsafe<ChannelProductRecord[]>(
      `
        SELECT
          authz.channel_id AS "channelId",
          product.id AS "productId",
          product.product_code AS "productCode",
          product.product_name AS "productName",
          product.carrier_code AS "carrierCode",
          product.province_name AS province,
          product.face_value AS "faceValue",
          product.recharge_mode AS "productType",
          price.sale_price AS "salePrice",
          (authz.status = 'ACTIVE') AS authorized,
          supplier.id AS "routeSupplierId",
          supplier.supplier_name AS "routeSupplierName",
          mapping.supplier_product_code AS "routeSupplierProductCode",
          mapping.cost_price AS "routeCostPrice",
          mapping.dynamic_updated_at AS "latestSnapshotAt",
          ${effectiveStatusSql} AS status
        FROM channel.channel_product_authorizations AS authz
        INNER JOIN product.recharge_products AS product
          ON product.id = authz.product_id
        LEFT JOIN channel.channel_price_policies AS price
          ON price.channel_id = authz.channel_id
         AND price.product_id = authz.product_id
        LEFT JOIN LATERAL (
          SELECT *
          FROM product.product_supplier_mappings AS mapping
          WHERE mapping.product_id = product.id
            AND mapping.status = 'ACTIVE'
            AND mapping.sales_status = 'ON_SALE'
          ORDER BY mapping.priority ASC, mapping.updated_at DESC
          LIMIT 1
        ) AS mapping ON TRUE
        LEFT JOIN supplier.suppliers AS supplier
          ON supplier.id = mapping.supplier_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY product.carrier_code ASC, product.province_name ASC, product.face_value ASC
      `,
      params,
    );

    return rows.map((row) => this.mapProduct(row));
  }

  async findChannelBalance(channelId: string): Promise<ChannelBalanceRecord | null> {
    const row = await first<ChannelBalanceRecord & { availableBalance: number | string; frozenBalance: number | string }>(
      db<
        (ChannelBalanceRecord & {
          availableBalance: number | string;
          frozenBalance: number | string;
        })[]
      >`
        SELECT
          ${channelId} AS "channelId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status,
          updated_at AS "updatedAt"
        FROM ledger.accounts
        WHERE owner_type = 'CHANNEL'
          AND owner_id = ${channelId}
        LIMIT 1
      `,
    );

    return row
      ? {
          channelId: row.channelId,
          availableBalance: Number(row.availableBalance),
          frozenBalance: Number(row.frozenBalance),
          currency: row.currency,
          status: row.status,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  async listChannelRechargeRecords(
    channelId: string,
  ): Promise<ChannelRechargeRecord[]> {
    const rows = await db<
      (ChannelRechargeRecord & {
        amount: number | string;
        beforeBalance: number | string;
        afterBalance: number | string;
      })[]
    >`
      SELECT
        id AS "recordId",
        channel_id AS "channelId",
        amount,
        before_balance AS "beforeBalance",
        after_balance AS "afterBalance",
        currency,
        record_source AS "recordSource",
        remark,
        operator_user_id AS "operatorUserId",
        operator_username AS "operatorUsername",
        created_at AS "createdAt"
      FROM channel.channel_recharge_records
      WHERE channel_id = ${channelId}
      ORDER BY created_at DESC, id DESC
    `;

    return rows.map((row) => this.mapRechargeRecord(row));
  }

  async findSplitPolicyByChannelId(channelId: string): Promise<ChannelSplitPolicy | null> {
    const row = await first<
      ChannelSplitPolicy & {
        allowedFaceValues: unknown;
      }
    >(db<
      (ChannelSplitPolicy & {
        allowedFaceValues: unknown;
      })[]
    >`
      SELECT
        id,
        channel_id AS "channelId",
        enabled,
        allowed_face_values_json AS "allowedFaceValues",
        prefer_max_single_face_value AS "preferMaxSingleFaceValue",
        max_split_pieces AS "maxSplitPieces",
        province_override AS "provinceOverride",
        carrier_override AS "carrierOverride",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM channel.channel_split_policies
      WHERE channel_id = ${channelId}
      LIMIT 1
    `);

    return row ? this.mapSplitPolicy(row) : null;
  }

  async upsertSplitPolicy(input: {
    channelId: string;
    enabled: boolean;
    allowedFaceValues: number[];
    preferMaxSingleFaceValue: boolean;
    maxSplitPieces: number;
    provinceOverride?: string | null;
    carrierOverride?: string | null;
  }): Promise<void> {
    await db`
      INSERT INTO channel.channel_split_policies (
        id,
        channel_id,
        enabled,
        allowed_face_values_json,
        prefer_max_single_face_value,
        max_split_pieces,
        province_override,
        carrier_override,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.channelId},
        ${input.enabled},
        ${JSON.stringify(input.allowedFaceValues)},
        ${input.preferMaxSingleFaceValue},
        ${input.maxSplitPieces},
        ${input.provinceOverride ?? null},
        ${input.carrierOverride ?? null},
        NOW(),
        NOW()
      )
      ON CONFLICT (channel_id) DO UPDATE
      SET
        enabled = EXCLUDED.enabled,
        allowed_face_values_json = EXCLUDED.allowed_face_values_json,
        prefer_max_single_face_value = EXCLUDED.prefer_max_single_face_value,
        max_split_pieces = EXCLUDED.max_split_pieces,
        province_override = EXCLUDED.province_override,
        carrier_override = EXCLUDED.carrier_override,
        updated_at = NOW()
    `;
  }
}
