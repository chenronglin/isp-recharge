import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const CreateChannelBodySchema = t.Object({
  channelCode: t.String({ minLength: 2 }),
  channelName: t.String({ minLength: 1 }),
  channelType: t.String({ minLength: 1 }),
  contactName: t.Optional(t.String()),
  contactPhone: t.Optional(t.String()),
  contactEmail: t.Optional(t.String()),
  baseUrl: t.Optional(t.String()),
  protocolType: t.Optional(t.String({ minLength: 1 })),
  accessAccount: t.Optional(t.String()),
  accessPassword: t.Optional(t.String({ minLength: 6 })),
  cooperationStatus: t.Optional(t.String({ minLength: 1 })),
  supportsConsumptionLog: t.Optional(t.Boolean()),
  settlementMode: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  remark: t.Optional(t.String()),
});

export const UpdateChannelBodySchema = CreateChannelBodySchema;

export const PortalLoginBodySchema = t.Object({
  username: t.String({ minLength: 1 }),
  password: t.String({ minLength: 1 }),
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

export const UpsertSplitPolicyBodySchema = t.Object({
  enabled: t.Boolean(),
  allowedFaceValues: t.Array(t.Number({ minimum: 1 })),
  preferMaxSingleFaceValue: t.Boolean(),
  maxSplitPieces: t.Number({ minimum: 1, maximum: 20 }),
  provinceOverride: t.Optional(t.String()),
  carrierOverride: t.Optional(t.String()),
});

export const ChannelsListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  cooperationStatus: t.Optional(t.String({ minLength: 1 })),
  protocolType: t.Optional(t.String({ minLength: 1 })),
  channelType: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const ChannelProductsQuerySchema = t.Object({
  carrierCode: t.Optional(t.String({ minLength: 1 })),
  province: t.Optional(t.String({ minLength: 1 })),
  faceValue: t.Optional(t.Numeric({ minimum: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
});

export const ChannelSchema = t.Object({
  id: t.String(),
  channelCode: t.String(),
  channelName: t.String(),
  channelType: t.String(),
  contactName: t.Nullable(t.String()),
  contactPhone: t.Nullable(t.String()),
  contactEmail: t.Nullable(t.String()),
  baseUrl: t.Nullable(t.String()),
  protocolType: t.String(),
  accessAccount: t.Nullable(t.String()),
  accessPassword: t.Nullable(t.String()),
  cooperationStatus: t.String(),
  supportsConsumptionLog: t.Boolean(),
  settlementMode: t.String(),
  status: t.String(),
  remark: t.Nullable(t.String()),
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

export const ChannelProductSchema = t.Object({
  channelId: t.String(),
  productId: t.String(),
  productName: t.String(),
  carrierCode: t.String(),
  province: t.String(),
  faceValueFen: t.Number(),
  salePriceFen: t.Nullable(t.Number()),
  authorized: t.Boolean(),
  routeSupplierId: t.Nullable(t.String()),
  routeSupplierName: t.Nullable(t.String()),
  latestSnapshotAt: t.Nullable(t.String({ format: 'date-time' })),
  status: t.String(),
});

export const ChannelBalanceSchema = t.Object({
  channelId: t.String(),
  availableBalanceFen: t.Number(),
  frozenBalanceFen: t.Number(),
  currency: t.String(),
  status: t.String(),
  updatedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const ChannelRechargeRecordSchema = t.Object({
  recordId: t.String(),
  channelId: t.String(),
  amountFen: t.Number(),
  beforeBalanceFen: t.Number(),
  afterBalanceFen: t.Number(),
  currency: t.String(),
  recordSource: t.String(),
  remark: t.Nullable(t.String()),
  operatorUserId: t.Nullable(t.String()),
  operatorUsername: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
});

export const ChannelSplitPolicySchema = t.Object({
  id: t.String(),
  channelId: t.String(),
  enabled: t.Boolean(),
  allowedFaceValues: t.Array(t.Number()),
  preferMaxSingleFaceValue: t.Boolean(),
  maxSplitPieces: t.Number(),
  provinceOverride: t.Nullable(t.String()),
  carrierOverride: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const PortalMeSchema = t.Object({
  channelId: t.String(),
  channelCode: t.String(),
  channelName: t.String(),
  status: t.String(),
  roleCodes: t.Array(t.String()),
  permissions: t.Array(t.String()),
});

export const PortalLoginResultSchema = t.Object({
  accessToken: t.String(),
  expiresInSeconds: t.Number(),
  me: PortalMeSchema,
});
