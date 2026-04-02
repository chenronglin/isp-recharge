import { t } from 'elysia';

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
