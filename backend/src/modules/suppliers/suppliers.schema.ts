import { t } from 'elysia';

export const CreateSupplierBodySchema = t.Object({
  supplierCode: t.String({ minLength: 2 }),
  supplierName: t.String({ minLength: 1 }),
  protocolType: t.String({ minLength: 1 }),
});

export const CreateSupplierConfigBodySchema = t.Object({
  supplierId: t.String(),
  configJson: t.Record(t.String(), t.Unknown()),
  credential: t.String({ minLength: 1 }),
  callbackSecret: t.String({ minLength: 1 }),
  timeoutMs: t.Optional(t.Number({ minimum: 100 })),
});

export const SupplierSubmitBodySchema = t.Object({
  orderNo: t.String(),
});

export const SupplierQueryBodySchema = t.Object({
  orderNo: t.String(),
  supplierOrderNo: t.String(),
});

export const SupplierCallbackBodySchema = t.Object({
  supplierOrderNo: t.String(),
  status: t.Union([t.Literal('SUCCESS'), t.Literal('FAIL')]),
  reason: t.Optional(t.String()),
});
