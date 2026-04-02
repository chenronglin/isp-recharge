import { t } from 'elysia';

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
