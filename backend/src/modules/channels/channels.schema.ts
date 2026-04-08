import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const CreateChannelBodySchema = t.Object({
  channelCode: t.String({ minLength: 2 }),
  channelName: t.String({ minLength: 1 }),
  channelType: t.String({ minLength: 1 }),
});

export const CreateCredentialBodySchema = t.Object({
  channelId: t.String(),
  accessKey: t.String({ minLength: 3 }),
  secretKey: t.String({ minLength: 3 }),
});

export const CreateAuthorizationBodySchema = t.Object({
  channelId: t.String(),
  productId: t.String(),
});

export const CreatePricePolicyBodySchema = t.Object({
  channelId: t.String(),
  productId: t.String(),
  salePrice: t.Number({ minimum: 0 }),
});

export const CreateLimitRuleBodySchema = t.Object({
  channelId: t.String(),
  singleLimit: t.Number({ minimum: 0 }),
  dailyLimit: t.Number({ minimum: 0 }),
  monthlyLimit: t.Number({ minimum: 0 }),
  qpsLimit: t.Number({ minimum: 1 }),
});

export const CreateCallbackConfigBodySchema = t.Object({
  channelId: t.String(),
  callbackUrl: t.String({ minLength: 1 }),
  signSecret: t.String({ minLength: 3 }),
  timeoutSeconds: t.Optional(t.Number({ minimum: 1 })),
});

export const ChannelsListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const ChannelSchema = t.Object({
  id: t.String(),
  channelCode: t.String(),
  channelName: t.String(),
  channelType: t.String(),
  status: t.String(),
  settlementMode: t.String(),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const ChannelCredentialSchema = t.Object({
  id: t.String(),
  channelId: t.String(),
  accessKey: t.String(),
  signAlgorithm: t.String(),
  status: t.String(),
  expiresAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const ChannelCallbackConfigSchema = t.Object({
  id: t.String(),
  channelId: t.String(),
  callbackUrl: t.String(),
  signType: t.String(),
  retryEnabled: t.Boolean(),
  timeoutSeconds: t.Number(),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const ChannelOrderPolicySchema = t.Object({
  channelId: t.String(),
  authorizedProductIds: t.Array(t.String()),
  limitRule: t.Nullable(
    t.Object({
      singleLimitAmountFen: t.Number(),
      dailyLimitAmountFen: t.Number(),
      monthlyLimitAmountFen: t.Number(),
      qpsLimit: t.Number(),
    }),
  ),
  pricePolicies: t.Array(
    t.Object({
      id: t.String(),
      productId: t.String(),
      saleAmountFen: t.Number(),
      currency: t.String(),
      status: t.String(),
      effectiveFrom: t.Nullable(t.String({ format: 'date-time' })),
      effectiveTo: t.Nullable(t.String({ format: 'date-time' })),
    }),
  ),
});
