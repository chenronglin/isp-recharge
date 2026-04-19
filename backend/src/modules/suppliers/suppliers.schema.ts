import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const SuppliersListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  cooperationStatus: t.Optional(t.String({ minLength: 1 })),
  healthStatus: t.Optional(t.String({ minLength: 1 })),
  protocolType: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const SaveSupplierBodySchema = t.Object({
  supplierCode: t.Optional(t.String({ minLength: 2 })),
  supplierName: t.String({ minLength: 1 }),
  contactName: t.Optional(t.String()),
  contactPhone: t.Optional(t.String()),
  contactEmail: t.Optional(t.String()),
  baseUrl: t.Optional(t.String()),
  protocolType: t.String({ minLength: 1 }),
  credentialMode: t.Optional(t.String({ minLength: 1 })),
  accessAccount: t.Optional(t.String()),
  accessPassword: t.Optional(t.String({ minLength: 1 })),
  cooperationStatus: t.Optional(t.String({ minLength: 1 })),
  supportsBalanceQuery: t.Optional(t.Boolean()),
  supportsRechargeRecords: t.Optional(t.Boolean()),
  supportsConsumptionLog: t.Optional(t.Boolean()),
  remark: t.Optional(t.String()),
  healthStatus: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
});

export const SupplierSchema = t.Object({
  supplierId: t.String(),
  supplierCode: t.String(),
  supplierName: t.String(),
  contactName: t.Nullable(t.String()),
  contactPhone: t.Nullable(t.String()),
  contactEmail: t.Nullable(t.String()),
  baseUrl: t.Nullable(t.String()),
  protocolType: t.String(),
  credentialMode: t.String(),
  accessAccount: t.Nullable(t.String()),
  accessPassword: t.Nullable(t.String()),
  cooperationStatus: t.String(),
  supportsBalanceQuery: t.Boolean(),
  supportsRechargeRecords: t.Boolean(),
  supportsConsumptionLog: t.Boolean(),
  remark: t.Nullable(t.String()),
  healthStatus: t.String(),
  lastHealthCheckAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const CreateSupplierConfigBodySchema = t.Object({
  supplierId: t.String(),
  configJson: t.Record(t.String(), t.Unknown()),
  credential: t.String({ minLength: 1 }),
  callbackSecret: t.String({ minLength: 1 }),
  timeoutMs: t.Optional(t.Number({ minimum: 100 })),
});

export const SupplierConfigSchema = t.Object({
  supplierId: t.String(),
  timeoutMs: t.Number(),
  credential: t.String(),
  callbackSecret: t.String(),
  configJson: t.Record(t.String(), t.Unknown()),
  updatedAt: t.Nullable(t.String({ format: 'date-time' })),
  updatedBy: t.Nullable(t.String()),
});

export const SupplierBalanceSchema = t.Object({
  supplierId: t.String(),
  balanceAmountFen: t.Number(),
  currency: t.String(),
  balanceStatus: t.String(),
  sourceType: t.String(),
  queriedAt: t.String({ format: 'date-time' }),
  rawPayload: t.Record(t.String(), t.Unknown()),
});

export const SupplierHealthSchema = t.Object({
  supplierId: t.String(),
  healthStatus: t.String(),
  httpStatus: t.Nullable(t.Number()),
  message: t.Nullable(t.String()),
  lastSuccessAt: t.Nullable(t.String({ format: 'date-time' })),
  lastFailureAt: t.Nullable(t.String({ format: 'date-time' })),
  checkedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const SupplierConsumptionLogQuerySchema = t.Object({
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  mobile: t.Optional(t.String({ minLength: 1 })),
  orderNo: t.Optional(t.String({ minLength: 1 })),
  supplierOrderNo: t.Optional(t.String({ minLength: 1 })),
});

export const SupplierConsumptionLogSchema = t.Object({
  id: t.String(),
  supplierId: t.String(),
  mobile: t.String(),
  orderNo: t.Nullable(t.String()),
  supplierOrderNo: t.Nullable(t.String()),
  amountFen: t.Number(),
  status: t.String(),
  occurredAt: t.String({ format: 'date-time' }),
  rawPayload: t.Record(t.String(), t.Unknown()),
});

export const SupplierProductsQuerySchema = t.Object({
  carrierCode: t.Optional(t.String({ minLength: 1 })),
  province: t.Optional(t.String({ minLength: 1 })),
  faceValue: t.Optional(t.Numeric({ minimum: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  updatedStartTime: t.Optional(t.String({ format: 'date-time' })),
  updatedEndTime: t.Optional(t.String({ format: 'date-time' })),
});

export const SupplierProductSnapshotSchema = t.Object({
  snapshotId: t.String(),
  supplierId: t.String(),
  supplierCode: t.String(),
  supplierProductCode: t.String(),
  productName: t.String(),
  carrierCode: t.String(),
  province: t.String(),
  faceValueFen: t.Number(),
  costPriceFen: t.Number(),
  saleStatus: t.String(),
  stockStatus: t.String(),
  arrivalSla: t.String(),
  rechargeRange: t.Any(),
  updatedAt: t.String({ format: 'date-time' }),
  rawPayload: t.Record(t.String(), t.Unknown()),
});

export const CreateSupplierRechargeRecordBodySchema = t.Object({
  rechargeType: t.String({ minLength: 1 }),
  amountFen: t.Number({ minimum: 1 }),
  currency: t.Optional(t.String({ minLength: 1 })),
  beforeBalanceFen: t.Optional(t.Number({ minimum: 0 })),
  afterBalanceFen: t.Optional(t.Number({ minimum: 0 })),
  recordSource: t.String({ minLength: 1 }),
  supplierTradeNo: t.Optional(t.String()),
  remark: t.Optional(t.String()),
  rawPayload: t.Optional(t.Record(t.String(), t.Unknown())),
  status: t.Optional(t.String({ minLength: 1 })),
});

export const SupplierRechargeRecordSchema = t.Object({
  recordId: t.String(),
  supplierId: t.String(),
  rechargeType: t.String(),
  amountFen: t.Number(),
  currency: t.String(),
  beforeBalanceFen: t.Number(),
  afterBalanceFen: t.Number(),
  recordSource: t.String(),
  supplierTradeNo: t.Nullable(t.String()),
  remark: t.Nullable(t.String()),
  rawPayload: t.Record(t.String(), t.Unknown()),
  status: t.String(),
  operatorUserId: t.Nullable(t.String()),
  operatorUsername: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
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
