import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

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

export const RiskRulesQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const RiskBlackWhiteListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const RiskDecisionsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const RiskRuleSchema = t.Object({
  id: t.String(),
  ruleCode: t.String(),
  ruleName: t.String(),
  ruleType: t.String(),
  configJson: t.Record(t.String(), t.Unknown()),
  priority: t.Number(),
  status: t.String(),
});

export const RiskBlackWhiteEntrySchema = t.Object({
  id: t.String(),
  entryType: t.String(),
  targetValue: t.String(),
  listType: t.String(),
  status: t.String(),
});

export const RiskDecisionRecordSchema = t.Object({
  id: t.String(),
  orderNo: t.Nullable(t.String()),
  channelId: t.Nullable(t.String()),
  decision: t.String(),
  reason: t.String(),
  hitRules: t.Array(t.String()),
  contextJson: t.Record(t.String(), t.Unknown()),
  createdAt: t.String({ format: 'date-time' }),
});
