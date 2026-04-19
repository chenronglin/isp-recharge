import { addDays } from '@/lib/time';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '@/lib/errors';
import { generateBusinessNo } from '@/lib/id';
import { extractBearerToken } from '@/lib/request';
import {
  buildOpenApiCanonicalString,
  decryptText,
  encryptText,
  hashPassword,
  hashToken,
  safeEqual,
  signOpenApiPayload,
  verifyPassword,
} from '@/lib/security';
import { toAmountFen, toIsoDateTime } from '@/lib/utils';
import type { ChannelsRepository } from '@/modules/channels/channels.repository';
import type { ChannelContract } from '@/modules/channels/contracts';
import type {
  Channel,
  ChannelBalanceRecord,
  ChannelRechargeRecord,
  ChannelSplitPolicy,
  OpenChannelContext,
} from '@/modules/channels/channels.types';

function isUniqueConstraintViolation(error: unknown): error is { code?: string; errno?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && (error as { code?: unknown }).code === '23505') ||
      ('errno' in error && (error as { errno?: unknown }).errno === '23505'))
  );
}

const portalLoginFailureLockThreshold = 5;
const portalLoginFailureLockMinutes = 15;
const portalSessionExpiresInSeconds = 7 * 24 * 60 * 60;
const portalPermissions = [
  'products:read',
  'orders:create',
  'orders:read',
  'orders:refresh',
  'batch:create',
  'batch:read',
  'customers:read',
  'exports:create',
  'jobs:read',
] as const;

export class ChannelsService implements ChannelContract {
  constructor(private readonly repository: ChannelsRepository) {}

  private sanitizeNullableText(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private toMaskedChannel(channel: Channel) {
    return {
      id: channel.id,
      channelCode: channel.channelCode,
      channelName: channel.channelName,
      channelType: channel.channelType,
      contactName: channel.contactName,
      contactPhone: channel.contactPhone,
      contactEmail: channel.contactEmail,
      baseUrl: channel.baseUrl,
      protocolType: channel.protocolType,
      accessAccount: channel.accessAccount,
      accessPassword: channel.accessPasswordHash ? '******' : null,
      cooperationStatus: channel.cooperationStatus,
      supportsConsumptionLog: channel.supportsConsumptionLog,
      settlementMode: channel.settlementMode,
      status: channel.status,
      remark: channel.remark,
      createdAt: toIsoDateTime(channel.createdAt) ?? channel.createdAt,
      updatedAt: toIsoDateTime(channel.updatedAt) ?? channel.updatedAt,
    };
  }

  private toPortalMe(channel: Channel) {
    return {
      channelId: channel.id,
      channelCode: channel.channelCode,
      channelName: channel.channelName,
      status: channel.status,
      roleCodes: ['CHANNEL_PORTAL'],
      permissions: [...portalPermissions],
    };
  }

  private toBalanceDto(channelId: string, balance: ChannelBalanceRecord | null) {
    return {
      channelId,
      availableBalanceFen: toAmountFen(balance?.availableBalance ?? 0) ?? 0,
      frozenBalanceFen: toAmountFen(balance?.frozenBalance ?? 0) ?? 0,
      currency: balance?.currency ?? 'CNY',
      status: balance?.status ?? 'ACTIVE',
      updatedAt: toIsoDateTime(balance?.updatedAt ?? null),
    };
  }

  private toRechargeRecordDto(record: ChannelRechargeRecord) {
    return {
      recordId: record.recordId,
      channelId: record.channelId,
      amountFen: toAmountFen(record.amount) ?? 0,
      beforeBalanceFen: toAmountFen(record.beforeBalance) ?? 0,
      afterBalanceFen: toAmountFen(record.afterBalance) ?? 0,
      currency: record.currency,
      recordSource: record.recordSource,
      remark: record.remark,
      operatorUserId: record.operatorUserId,
      operatorUsername: record.operatorUsername,
      createdAt: toIsoDateTime(record.createdAt) ?? record.createdAt,
    };
  }

  private toSplitPolicyDto(channelId: string, policy: ChannelSplitPolicy | null) {
    if (!policy) {
      return {
        id: `virtual-${channelId}`,
        channelId,
        enabled: false,
        allowedFaceValues: [],
        preferMaxSingleFaceValue: true,
        maxSplitPieces: 1,
        provinceOverride: null,
        carrierOverride: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      ...policy,
      createdAt: toIsoDateTime(policy.createdAt) ?? policy.createdAt,
      updatedAt: toIsoDateTime(policy.updatedAt) ?? policy.updatedAt,
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
  }) {
    const result = await this.repository.listChannels(input);
    return {
      items: result.items.map((item) => this.toMaskedChannel(item)),
      total: result.total,
    };
  }

  async createChannel(input: {
    channelCode: string;
    channelName: string;
    channelType: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    baseUrl?: string;
    protocolType?: string;
    accessAccount?: string;
    accessPassword?: string;
    cooperationStatus?: string;
    supportsConsumptionLog?: boolean;
    settlementMode?: string;
    status?: string;
    remark?: string;
  }) {
    const existing = await this.repository.findChannelByCode(input.channelCode.trim());

    if (existing) {
      throw conflict('渠道编码已存在');
    }

    const accessAccount = this.sanitizeNullableText(input.accessAccount);
    const accessPassword = this.sanitizeNullableText(input.accessPassword);

    if (accessPassword && !accessAccount) {
      throw badRequest('设置门户密码前必须提供 accessAccount');
    }

    if (accessAccount) {
      const duplicateAccount = await this.repository.findChannelByAccessAccount(accessAccount);

      if (duplicateAccount) {
        throw conflict('门户登录账号已存在');
      }
    }

    const channel = await this.repository.createChannel({
      channelCode: input.channelCode.trim(),
      channelName: input.channelName.trim(),
      channelType: input.channelType.trim(),
      contactName: this.sanitizeNullableText(input.contactName),
      contactPhone: this.sanitizeNullableText(input.contactPhone),
      contactEmail: this.sanitizeNullableText(input.contactEmail),
      baseUrl: this.sanitizeNullableText(input.baseUrl),
      protocolType: this.sanitizeNullableText(input.protocolType) ?? 'REST',
      accessAccount,
      accessPasswordHash: accessPassword ? await hashPassword(accessPassword) : null,
      cooperationStatus: this.sanitizeNullableText(input.cooperationStatus) ?? 'ACTIVE',
      supportsConsumptionLog: input.supportsConsumptionLog ?? false,
      settlementMode: this.sanitizeNullableText(input.settlementMode) ?? 'PREPAID',
      status: this.sanitizeNullableText(input.status) ?? 'ACTIVE',
      remark: this.sanitizeNullableText(input.remark),
    });

    return this.toMaskedChannel(channel);
  }

  async updateChannel(
    channelId: string,
    input: {
      channelName?: string;
      channelType?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      baseUrl?: string;
      protocolType?: string;
      accessAccount?: string;
      accessPassword?: string;
      cooperationStatus?: string;
      supportsConsumptionLog?: boolean;
      settlementMode?: string;
      status?: string;
      remark?: string;
    },
  ) {
    const existing = await this.repository.findChannelById(channelId);

    if (!existing) {
      throw notFound('渠道不存在');
    }

    const accessAccount = this.sanitizeNullableText(input.accessAccount);
    const accessPassword = this.sanitizeNullableText(input.accessPassword);

    if (accessPassword && !accessAccount) {
      throw badRequest('设置门户密码前必须提供 accessAccount');
    }

    if (accessAccount && accessAccount !== existing.accessAccount) {
      const duplicateAccount = await this.repository.findChannelByAccessAccount(accessAccount);

      if (duplicateAccount && duplicateAccount.id !== channelId) {
        throw conflict('门户登录账号已存在');
      }
    }

    const updated = await this.repository.updateChannel(channelId, {
      channelName: this.sanitizeNullableText(input.channelName) ?? existing.channelName,
      channelType: this.sanitizeNullableText(input.channelType) ?? existing.channelType,
      contactName: this.sanitizeNullableText(input.contactName),
      contactPhone: this.sanitizeNullableText(input.contactPhone),
      contactEmail: this.sanitizeNullableText(input.contactEmail),
      baseUrl: this.sanitizeNullableText(input.baseUrl),
      protocolType: this.sanitizeNullableText(input.protocolType) ?? existing.protocolType,
      accessAccount,
      accessPasswordHash: accessPassword ? await hashPassword(accessPassword) : null,
      cooperationStatus: this.sanitizeNullableText(input.cooperationStatus) ?? existing.cooperationStatus,
      supportsConsumptionLog: input.supportsConsumptionLog ?? existing.supportsConsumptionLog,
      settlementMode: this.sanitizeNullableText(input.settlementMode) ?? existing.settlementMode,
      status: this.sanitizeNullableText(input.status) ?? existing.status,
      remark: this.sanitizeNullableText(input.remark),
    });

    if (!updated) {
      throw notFound('渠道不存在');
    }

    return this.toMaskedChannel(updated);
  }

  async portalLogin(input: {
    username: string;
    password: string;
    ip: string;
    deviceSummary: string;
  }) {
    const channel = await this.repository.findChannelByAccessAccount(input.username.trim());

    if (!channel) {
      await this.repository.recordPortalLoginAttempt({
        channelId: null,
        username: input.username.trim(),
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason: 'USER_NOT_FOUND',
      });
      throw unauthorized('用户名或密码错误');
    }

    if (channel.lockedUntil && new Date(channel.lockedUntil).getTime() > Date.now()) {
      await this.repository.recordPortalLoginAttempt({
        channelId: channel.id,
        username: channel.accessAccount ?? input.username.trim(),
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason: 'ACCOUNT_LOCKED',
      });
      throw forbidden('账号已被临时锁定');
    }

    if (!channel.accessPasswordHash) {
      throw forbidden('渠道未配置门户登录密码');
    }

    if (channel.status !== 'ACTIVE') {
      throw forbidden('渠道账号已禁用');
    }

    const passwordValid = await verifyPassword(input.password, channel.accessPasswordHash);

    if (!passwordValid) {
      const failureState = await this.repository.recordFailedPortalPasswordAttempt(
        channel.id,
        portalLoginFailureLockThreshold,
        portalLoginFailureLockMinutes,
      );
      await this.repository.recordPortalLoginAttempt({
        channelId: channel.id,
        username: channel.accessAccount ?? input.username.trim(),
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason:
          failureState.lockedUntil && new Date(failureState.lockedUntil).getTime() > Date.now()
            ? 'ACCOUNT_LOCKED'
            : 'PASSWORD_INVALID',
      });
      throw unauthorized('用户名或密码错误');
    }

    await this.repository.clearPortalLoginFailures(channel.id);
    await this.repository.recordPortalLoginAttempt({
      channelId: channel.id,
      username: channel.accessAccount ?? input.username.trim(),
      ip: input.ip,
      deviceSummary: input.deviceSummary,
      result: 'SUCCESS',
      failureReason: null,
    });

    const accessToken = generateBusinessNo('portal');
    await this.repository.createPortalSession({
      channelId: channel.id,
      accessTokenHash: hashToken(accessToken),
      expiresAt: addDays(new Date(), 7),
    });

    return {
      accessToken,
      expiresInSeconds: portalSessionExpiresInSeconds,
      me: this.toPortalMe(channel),
    };
  }

  async portalLogout(authorization?: string | null): Promise<void> {
    const token = extractBearerToken(authorization);

    if (!token) {
      throw unauthorized('缺少渠道门户 Bearer Token');
    }

    await this.repository.revokePortalSessionByHash(hashToken(token));
  }

  async getPortalMe(authorization?: string | null) {
    const context = await this.resolveChannelAuthContext({
      authorization,
      accessKey: '',
      signature: '',
      timestamp: '',
      nonce: '',
      method: 'GET',
      path: '/portal/me',
      bodyText: '',
    });

    if (context.authType !== 'PORTAL') {
      throw unauthorized('当前请求未使用门户登录态');
    }

    return this.toPortalMe(context.channel);
  }

  async resolveChannelAuthContext(input: {
    authorization?: string | null;
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }): Promise<OpenChannelContext> {
    const bearerToken = extractBearerToken(input.authorization);

    if (bearerToken) {
      const session = await this.repository.findActivePortalSessionByHash(hashToken(bearerToken));

      if (!session) {
        throw unauthorized('渠道门户会话无效或已过期');
      }

      const channel = await this.repository.findChannelById(session.channelId);

      if (!channel || channel.status !== 'ACTIVE') {
        throw unauthorized('渠道不可用');
      }

      return {
        channel,
        authType: 'PORTAL',
        credential: null,
      };
    }

    return this.authenticateOpenRequest({
      accessKey: input.accessKey,
      signature: input.signature,
      timestamp: input.timestamp,
      nonce: input.nonce,
      method: input.method,
      path: input.path,
      bodyText: input.bodyText,
    });
  }

  async authenticateOpenRequest(input: {
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }): Promise<OpenChannelContext> {
    const credential = await this.repository.findCredentialByAccessKey(input.accessKey);

    if (!credential) {
      throw unauthorized('AccessKey 不存在');
    }

    const channel = await this.repository.findChannelById(credential.channelId);

    if (!channel) {
      throw unauthorized('渠道不存在');
    }

    if (credential.status !== 'ACTIVE' || channel.status !== 'ACTIVE') {
      throw forbidden('渠道或凭证不可用');
    }

    const timestampNumber = Number(input.timestamp);

    if (Number.isNaN(timestampNumber)) {
      throw badRequest('Timestamp 非法');
    }

    const fiveMinutes = 5 * 60 * 1000;

    if (Math.abs(Date.now() - timestampNumber) > fiveMinutes) {
      throw unauthorized('请求时间超出允许范围');
    }

    if (!input.nonce) {
      throw badRequest('Nonce 不能为空');
    }

    const secret = decryptText(credential.secretKeyEncrypted);
    const canonical = buildOpenApiCanonicalString({
      method: input.method,
      path: input.path,
      timestamp: input.timestamp,
      nonce: input.nonce,
      body: input.bodyText,
    });
    const expectedSignature = signOpenApiPayload(secret, canonical);

    if (!safeEqual(expectedSignature, input.signature)) {
      throw unauthorized('开放接口签名校验失败');
    }

    try {
      await this.repository.consumeOpenNonce({
        accessKey: input.accessKey,
        nonce: input.nonce,
        path: input.path,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw unauthorized('Nonce 已被使用');
      }

      throw error;
    }

    return {
      channel,
      authType: 'SIGN',
      credential,
    };
  }

  async getOrderPolicy(input: { channelId: string; productId: string; orderAmount: number }) {
    const channel = await this.repository.findChannelById(input.channelId);

    if (!channel) {
      throw notFound('渠道不存在');
    }

    if (channel.status !== 'ACTIVE') {
      throw forbidden('渠道不可用');
    }

    const callbackConfig = await this.repository.findCallbackConfig(input.channelId);

    if (!callbackConfig) {
      throw badRequest('渠道未配置回调地址');
    }

    const limitRule = await this.repository.findLimitRule(input.channelId);

    if (limitRule && input.orderAmount > limitRule.singleLimit) {
      throw forbidden('订单金额超出单笔限额');
    }

    if (limitRule) {
      const todayAmount = await this.repository.sumOrderAmountToday(input.channelId);

      if (todayAmount + input.orderAmount > limitRule.dailyLimit) {
        throw forbidden('订单金额超出日限额');
      }

      const recentRequestCount = await this.repository.countRecentOpenOrderRequests(
        input.channelId,
        1,
      );

      if (recentRequestCount > limitRule.qpsLimit) {
        throw forbidden('渠道请求频率超限');
      }
    }

    let pricePolicy = null;

    if (input.productId) {
      const authorized = await this.repository.isAuthorized(input.channelId, input.productId);

      if (!authorized) {
        throw forbidden('当前渠道未授权该商品');
      }

      pricePolicy = await this.repository.findPricePolicy(input.channelId, input.productId);
    }

    return {
      channel,
      callbackConfig,
      limitRule,
      pricePolicy,
    };
  }

  async getCallbackConfig(channelId: string) {
    const callbackConfig = await this.repository.findCallbackConfig(channelId);

    if (!callbackConfig) {
      throw notFound('渠道回调配置不存在');
    }

    return callbackConfig;
  }

  async getChannelById(channelId: string) {
    const channel = await this.repository.findChannelById(channelId);

    if (!channel) {
      throw notFound('渠道不存在');
    }

    return this.toMaskedChannel(channel);
  }

  async listCredentials() {
    return this.repository.listCredentials();
  }

  async createCredential(input: { channelId: string; accessKey: string; secretKey: string }) {
    const channel = await this.repository.findChannelById(input.channelId);

    if (!channel) {
      throw notFound('渠道不存在');
    }

    await this.repository.upsertCredential({
      channelId: input.channelId,
      accessKey: input.accessKey,
      secretKeyEncrypted: encryptText(input.secretKey),
    });
  }

  async addAuthorization(input: { channelId: string; productId: string }) {
    await this.repository.addAuthorization(input);
  }

  async upsertPricePolicy(input: { channelId: string; productId: string; salePrice: number }) {
    await this.repository.upsertPricePolicy(input);
  }

  async upsertLimitRule(input: {
    channelId: string;
    singleLimit: number;
    dailyLimit: number;
    monthlyLimit: number;
    qpsLimit: number;
  }) {
    await this.repository.upsertLimitRule(input);
  }

  async upsertCallbackConfig(input: {
    channelId: string;
    callbackUrl: string;
    signSecret: string;
    timeoutSeconds: number;
  }) {
    await this.repository.upsertCallbackConfig({
      channelId: input.channelId,
      callbackUrl: input.callbackUrl,
      secretEncrypted: encryptText(input.signSecret),
      timeoutSeconds: input.timeoutSeconds,
    });
  }

  async listChannelCredentials(channelId: string) {
    await this.getChannelById(channelId);
    const credentials = await this.repository.listCredentialsByChannelId(channelId);

    return credentials.map((item) => ({
      id: item.id,
      channelId: item.channelId,
      accessKey: item.accessKey,
      signAlgorithm: item.signAlgorithm,
      status: item.status,
      expiresAt: toIsoDateTime(item.expiresAt),
      createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      updatedAt: toIsoDateTime(item.updatedAt) ?? item.updatedAt,
    }));
  }

  async getAdminCallbackConfig(channelId: string) {
    const callbackConfig = await this.getCallbackConfig(channelId);

    return {
      id: callbackConfig.id,
      channelId: callbackConfig.channelId,
      callbackUrl: callbackConfig.callbackUrl,
      signType: callbackConfig.signType,
      retryEnabled: callbackConfig.retryEnabled,
      timeoutSeconds: callbackConfig.timeoutSeconds,
      createdAt: toIsoDateTime(callbackConfig.createdAt) ?? callbackConfig.createdAt,
      updatedAt: toIsoDateTime(callbackConfig.updatedAt) ?? callbackConfig.updatedAt,
    };
  }

  async getAdminOrderPolicy(channelId: string) {
    await this.getChannelById(channelId);
    const [authorizedProductIds, limitRule, pricePolicies] = await Promise.all([
      this.repository.listAuthorizationsByChannelId(channelId),
      this.repository.findLimitRule(channelId),
      this.repository.listPricePoliciesByChannelId(channelId),
    ]);

    return {
      channelId,
      authorizedProductIds,
      limitRule: limitRule
        ? {
            singleLimitAmountFen: toAmountFen(limitRule.singleLimit) ?? 0,
            dailyLimitAmountFen: toAmountFen(limitRule.dailyLimit) ?? 0,
            monthlyLimitAmountFen: toAmountFen(limitRule.monthlyLimit) ?? 0,
            qpsLimit: limitRule.qpsLimit,
          }
        : null,
      pricePolicies: pricePolicies.map((item) => ({
        id: item.id,
        productId: item.productId,
        saleAmountFen: toAmountFen(item.salePrice) ?? 0,
        currency: item.currency,
        status: item.status,
        effectiveFrom: toIsoDateTime(item.effectiveFrom),
        effectiveTo: toIsoDateTime(item.effectiveTo),
      })),
    };
  }

  async listChannelProducts(channelId: string, filters: {
    carrierCode?: string;
    province?: string;
    faceValue?: number;
    productType?: string;
    status?: string;
  }) {
    await this.getChannelById(channelId);
    const items = await this.repository.listChannelProducts({
      channelId,
      carrierCode: filters.carrierCode,
      province: filters.province,
      faceValue: filters.faceValue,
      productType: filters.productType,
      status: filters.status,
    });

    return items.map((item) => ({
      channelId: item.channelId,
      productId: item.productId,
      productCode: item.productCode ?? null,
      productName: item.productName,
      carrierCode: item.carrierCode,
      province: item.province,
      faceValue: item.faceValue,
      faceValueFen: toAmountFen(item.faceValue) ?? 0,
      productType: item.productType ?? null,
      salePrice: item.salePrice,
      salePriceFen: item.salePrice === null ? null : (toAmountFen(item.salePrice) ?? 0),
      authorized: item.authorized,
      routeSupplierId: item.routeSupplierId,
      routeSupplierName: item.routeSupplierName,
      routeSupplierProductCode: item.routeSupplierProductCode ?? null,
      routeCostPrice: item.routeCostPrice ?? null,
      latestSnapshotAt: toIsoDateTime(item.latestSnapshotAt),
      status: item.status,
    }));
  }

  async getChannelBalance(channelId: string) {
    await this.getChannelById(channelId);
    return this.toBalanceDto(channelId, await this.repository.findChannelBalance(channelId));
  }

  async listChannelRechargeRecords(channelId: string) {
    await this.getChannelById(channelId);
    const rows = await this.repository.listChannelRechargeRecords(channelId);
    return rows.map((row) => this.toRechargeRecordDto(row));
  }

  async getSplitPolicy(channelId: string) {
    await this.getChannelById(channelId);
    return this.toSplitPolicyDto(channelId, await this.repository.findSplitPolicyByChannelId(channelId));
  }

  async upsertSplitPolicy(
    channelId: string,
    input: {
      enabled: boolean;
      allowedFaceValues: number[];
      preferMaxSingleFaceValue: boolean;
      maxSplitPieces: number;
      provinceOverride?: string | null;
      carrierOverride?: string | null;
    },
  ) {
    await this.getChannelById(channelId);
    await this.repository.upsertSplitPolicy({
      channelId,
      enabled: input.enabled,
      allowedFaceValues: [...new Set(input.allowedFaceValues.map((item) => Number(item)).filter((item) => item > 0))].sort(
        (left, right) => right - left,
      ),
      preferMaxSingleFaceValue: input.preferMaxSingleFaceValue,
      maxSplitPieces: input.maxSplitPieces,
      provinceOverride: this.sanitizeNullableText(input.provinceOverride),
      carrierOverride: this.sanitizeNullableText(input.carrierOverride),
    });

    return this.getSplitPolicy(channelId);
  }
}
