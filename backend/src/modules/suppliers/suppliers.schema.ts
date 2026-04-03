import { t } from 'elysia';

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

export const SupplierCatalogFullSyncBodySchema = t.Object({
  supplierCode: t.Optional(t.String()),
  items: t.Optional(t.Array(t.Any())),
});

export const SupplierCatalogDeltaSyncBodySchema = t.Object({
  supplierCode: t.Optional(t.String()),
  items: t.Optional(t.Array(t.Any())),
});

export const SupplierReconcileBodySchema = t.Object({
  reconcileDate: t.Optional(t.String()),
  onlyInflight: t.Optional(t.Boolean()),
});

export const SupplierCallbackBodySchema = t.Object({
  supplierOrderNo: t.String(),
  status: t.Union([t.Literal('SUCCESS'), t.Literal('FAIL')]),
  reason: t.Optional(t.String()),
});
