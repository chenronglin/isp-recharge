import { badRequest, forbidden, notFound, unauthorized } from '@/lib/errors';
import { toAmountFen, toIsoDateTime } from '@/lib/utils';
import {
  buildOpenApiCanonicalString,
  decryptText,
  encryptText,
  safeEqual,
  signOpenApiPayload,
} from '@/lib/security';
import type { ChannelsRepository } from '@/modules/channels/channels.repository';
import type { ChannelContract } from '@/modules/channels/contracts';

function isUniqueConstraintViolation(error: unknown): error is { code?: string; errno?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && (error as { code?: unknown }).code === '23505') ||
      ('errno' in error && (error as { errno?: unknown }).errno === '23505'))
  );
}

export class ChannelsService implements ChannelContract {
  constructor(private readonly repository: ChannelsRepository) {}

  private toChannel(channel: {
    id: string;
    channelCode: string;
    channelName: string;
    channelType: string;
    status: string;
    settlementMode: string;
    createdAt: string;
    updatedAt: string;
  }) {
    return {
      ...channel,
      createdAt: toIsoDateTime(channel.createdAt) ?? channel.createdAt,
      updatedAt: toIsoDateTime(channel.updatedAt) ?? channel.updatedAt,
    };
  }

  async listChannels(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listChannels(input);
    return {
      items: result.items.map((item) => this.toChannel(item)),
      total: result.total,
    };
  }

  async listCredentials() {
    return this.repository.listCredentials();
  }

  async createChannel(input: { channelCode: string; channelName: string; channelType: string }) {
    const existing = await this.repository.findChannelByCode(input.channelCode);

    if (existing) {
      throw badRequest('渠道编码已存在');
    }

    return this.repository.createChannel(input);
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

  async authenticateOpenRequest(input: {
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    bodyText: string;
  }) {
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

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (Math.abs(now - timestampNumber) > fiveMinutes) {
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

    return this.toChannel(channel);
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
}
