import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const RechargeChannelAccountBodySchema = t.Object({
  amount: t.Number({ minimum: 0.01 }),
  remark: t.String({ minLength: 1, maxLength: 255 }),
});

export const AccountsListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const LedgerEntriesListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
  accountId: t.Optional(t.String({ minLength: 1 })),
  orderNo: t.Optional(t.String({ minLength: 1 })),
  channelId: t.Optional(t.String({ minLength: 1 })),
  entryType: t.Optional(t.String({ minLength: 1 })),
  bizNo: t.Optional(t.String({ minLength: 1 })),
});

export const AccountSchema = t.Object({
  id: t.String(),
  ownerType: t.String(),
  ownerId: t.String(),
  availableBalanceFen: t.Number(),
  frozenBalanceFen: t.Number(),
  currency: t.String(),
  status: t.String(),
  createdAt: t.Nullable(t.String({ format: 'date-time' })),
  updatedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const LedgerEntrySchema = t.Object({
  id: t.String(),
  ledgerNo: t.String(),
  accountId: t.String(),
  orderNo: t.Nullable(t.String()),
  actionType: t.String(),
  direction: t.String(),
  amountFen: t.Number(),
  currency: t.String(),
  balanceBeforeFen: t.Number(),
  balanceAfterFen: t.Number(),
  referenceType: t.String(),
  referenceNo: t.String(),
  createdAt: t.String({ format: 'date-time' }),
});
