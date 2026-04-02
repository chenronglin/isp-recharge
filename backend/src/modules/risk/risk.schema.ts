import { t } from 'elysia';

export const CreateRiskRuleBodySchema = t.Object({
  ruleCode: t.String({ minLength: 2 }),
  ruleName: t.String({ minLength: 1 }),
  ruleType: t.String({ minLength: 1 }),
  configJson: t.Record(t.String(), t.Unknown()),
  priority: t.Optional(t.Number({ minimum: 1 })),
});

export const CreateBlackWhiteEntryBodySchema = t.Object({
  entryType: t.String({ minLength: 2 }),
  targetValue: t.String({ minLength: 1 }),
  listType: t.Union([t.Literal('BLACK'), t.Literal('WHITE')]),
  remark: t.Optional(t.String()),
});

export const PreCheckBodySchema = t.Object({
  channelId: t.String(),
  orderNo: t.Optional(t.String()),
  amount: t.Number({ minimum: 0 }),
  ip: t.Optional(t.String()),
  mobile: t.Optional(t.String()),
});
