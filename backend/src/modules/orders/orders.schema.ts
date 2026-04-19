import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const CreateOrderBodySchema = t.Object({
  channelOrderNo: t.String({ minLength: 1 }),
  mobile: t.String({ pattern: '^\\d{11}$' }),
  faceValue: t.Number({ minimum: 1 }),
  product_type: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
  ext: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const PreviewSplitBodySchema = t.Object({
  mobile: t.String({ pattern: '^\\d{11}$' }),
  faceValue: t.Number({ minimum: 1 }),
  productType: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
});

export const OpenOrdersListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  orderNo: t.Optional(t.String({ minLength: 1 })),
  channelOrderNo: t.Optional(t.String({ minLength: 1 })),
  mobile: t.Optional(t.String({ pattern: '^\\d{11}$' })),
  mainStatus: t.Optional(t.String({ minLength: 1 })),
  supplierStatus: t.Optional(t.String({ minLength: 1 })),
  refundStatus: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
});

export const ManualStatusBodySchema = t.Object({
  mainStatus: t.String({ minLength: 1 }),
  supplierStatus: t.Optional(t.String({ minLength: 1 })),
  refundStatus: t.Optional(t.String({ minLength: 1 })),
  remark: t.Optional(t.String()),
});

export const BatchOrdersBodySchema = t.Object({
  orders: t.Array(
    t.Object({
      channelOrderNo: t.String({ minLength: 1 }),
      mobile: t.String({ pattern: '^\\d{11}$' }),
      faceValue: t.Number({ minimum: 1 }),
      productType: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
      ext: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  ),
});

export const BatchImportBodySchema = t.Object({
  content: t.String({ minLength: 1 }),
});

export const RemarkBodySchema = t.Object({
  remark: t.String({ minLength: 1 }),
});

export const MarkExceptionBodySchema = t.Object({
  exceptionTag: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 }),
});

export const OrderAdminListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
  orderNo: t.Optional(t.String({ minLength: 1 })),
  channelOrderNo: t.Optional(t.String({ minLength: 1 })),
  mobile: t.Optional(t.String({ pattern: '^\\d{11}$' })),
  channelId: t.Optional(t.String({ minLength: 1 })),
  productId: t.Optional(t.String({ minLength: 1 })),
  mainStatus: t.Optional(t.String({ minLength: 1 })),
  supplierStatus: t.Optional(t.String({ minLength: 1 })),
  notifyStatus: t.Optional(t.String({ minLength: 1 })),
  refundStatus: t.Optional(t.String({ minLength: 1 })),
  exceptionTag: t.Optional(t.String({ minLength: 1 })),
  supplierOrderNo: t.Optional(t.String({ minLength: 1 })),
});

export const OrderEventsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const ActionReasonBodySchema = t.Object({
  reason: t.String({ minLength: 1 }),
});

export const AdminOrderListItemSchema = t.Object({
  orderNo: t.String(),
  channelOrderNo: t.String(),
  channelId: t.String(),
  productId: t.Nullable(t.String()),
  mobile: t.String(),
  province: t.Nullable(t.String()),
  ispName: t.Nullable(t.String()),
  requestedProductType: t.String(),
  faceValueAmountFen: t.Number(),
  saleAmountFen: t.Number(),
  purchaseAmountFen: t.Number(),
  currency: t.String(),
  mainStatus: t.String(),
  supplierStatus: t.String(),
  notifyStatus: t.String(),
  refundStatus: t.String(),
  monitorStatus: t.String(),
  exceptionTag: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
  finishedAt: t.Nullable(t.String({ format: 'date-time' })),
});

export const AdminOrderEventSchema = t.Object({
  id: t.String(),
  orderNo: t.String(),
  eventType: t.String(),
  sourceService: t.String(),
  sourceNo: t.Nullable(t.String()),
  beforeStatus: t.Record(t.String(), t.Unknown()),
  afterStatus: t.Record(t.String(), t.Unknown()),
  payload: t.Record(t.String(), t.Unknown()),
  operator: t.String(),
  occurredAt: t.String({ format: 'date-time' }),
});

export const AdminOrderDetailSchema = t.Object({
  basicInfo: t.Object({
    orderNo: t.String(),
    channelOrderNo: t.String(),
    channelId: t.String(),
    mobile: t.String(),
    province: t.Nullable(t.String()),
    ispName: t.Nullable(t.String()),
    productId: t.Nullable(t.String()),
    requestedProductType: t.String(),
    faceValueAmountFen: t.Number(),
    createdAt: t.String({ format: 'date-time' }),
    updatedAt: t.String({ format: 'date-time' }),
    finishedAt: t.Nullable(t.String({ format: 'date-time' })),
  }),
  paymentInfo: t.Object({
    currency: t.String(),
    saleAmountFen: t.Number(),
    purchaseAmountFen: t.Number(),
    grossProfitAmountFen: t.Number(),
    paymentStatus: t.Nullable(t.String()),
    refundStatus: t.String(),
  }),
  fulfillmentInfo: t.Object({
    mainStatus: t.String(),
    supplierStatus: t.String(),
    monitorStatus: t.String(),
    warningDeadlineAt: t.Nullable(t.String({ format: 'date-time' })),
    expireDeadlineAt: t.Nullable(t.String({ format: 'date-time' })),
    exceptionTag: t.Nullable(t.String()),
    remark: t.Nullable(t.String()),
  }),
  notificationInfo: t.Object({
    notifyStatus: t.String(),
    latestTaskNo: t.Nullable(t.String()),
    latestTaskStatus: t.Nullable(t.String()),
    latestTaskLastError: t.Nullable(t.String()),
    callbackUrl: t.Nullable(t.String()),
    retryEnabled: t.Nullable(t.Boolean()),
    timeoutSeconds: t.Nullable(t.Number()),
  }),
  riskInfo: t.Object({
    decision: t.Nullable(t.String()),
    reason: t.Nullable(t.String()),
    hitRules: t.Array(t.String()),
    snapshot: t.Record(t.String(), t.Unknown()),
  }),
  ledgerInfo: t.Object({
    currency: t.String(),
    saleAmountFen: t.Number(),
    purchaseAmountFen: t.Number(),
    grossProfitAmountFen: t.Number(),
    refundStatus: t.String(),
  }),
  businessSnapshot: t.Object({
    channel: t.Record(t.String(), t.Unknown()),
    product: t.Record(t.String(), t.Unknown()),
    callback: t.Record(t.String(), t.Unknown()),
    supplierRoute: t.Record(t.String(), t.Unknown()),
    risk: t.Record(t.String(), t.Unknown()),
    ext: t.Record(t.String(), t.Unknown()),
  }),
});
