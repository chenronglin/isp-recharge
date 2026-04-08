import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const RechargeCarrierCodeSchema = t.Union([
  t.Literal('CMCC'),
  t.Literal('CTCC'),
  t.Literal('CUCC'),
  t.Literal('CBN'),
]);

export const RechargeProductTypeSchema = t.Union([t.Literal('FAST'), t.Literal('MIXED')]);

export const RechargeProductStatusSchema = t.Union([t.Literal('ACTIVE'), t.Literal('INACTIVE')]);

export const SaveRechargeProductBodySchema = t.Object({
  productCode: t.String({ minLength: 1, maxLength: 128 }),
  productName: t.String({ minLength: 1, maxLength: 128 }),
  carrierCode: RechargeCarrierCodeSchema,
  provinceName: t.String({ minLength: 1, maxLength: 32 }),
  faceValue: t.Number({ minimum: 0.01 }),
  productType: RechargeProductTypeSchema,
  salesUnit: t.String({ minLength: 1, maxLength: 16 }),
  status: RechargeProductStatusSchema,
});

export const ProductIdParamsSchema = t.Object({
  productId: t.String({ minLength: 1 }),
});

export const AdminProductsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(RechargeProductStatusSchema),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
  carrierCode: t.Optional(RechargeCarrierCodeSchema),
  productType: t.Optional(RechargeProductTypeSchema),
});

export const AdminRechargeProductSchema = t.Object({
  id: t.String(),
  productCode: t.String(),
  productName: t.String(),
  carrierCode: RechargeCarrierCodeSchema,
  provinceName: t.String(),
  faceValueAmountFen: t.Number(),
  productType: RechargeProductTypeSchema,
  salesUnit: t.String(),
  status: RechargeProductStatusSchema,
});
