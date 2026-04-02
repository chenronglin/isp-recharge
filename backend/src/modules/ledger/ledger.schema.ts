import { t } from 'elysia';

export const RechargeChannelAccountBodySchema = t.Object({
  amount: t.Number({ minimum: 0.01 }),
  remark: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});
