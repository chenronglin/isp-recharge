export type MainOrderStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAIL'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'CLOSED';

export type SupplierOrderStatus = 'WAIT_SUBMIT' | 'ACCEPTED' | 'QUERYING' | 'SUCCESS' | 'FAIL';

export type OrderNotifyStatus = 'PENDING' | 'SUCCESS' | 'RETRYING' | 'DEAD_LETTER';

export type OrderRefundStatus = 'NONE' | 'PENDING' | 'SUCCESS' | 'FAIL';

export type OrderMonitorStatus =
  | 'NORMAL'
  | 'TIMEOUT_WARNING'
  | 'MANUAL_FOLLOWING'
  | 'LATE_CALLBACK_EXCEPTION';

export type RequestedProductType = 'FAST' | 'MIXED';

export interface OrderRecord {
  id: string;
  orderGroupId?: string;
  orderNo: string;
  parentOrderNo?: string | null;
  channelOrderNo: string;
  channelId: string;
  parentChannelId: string | null;
  supplierId?: string | null;
  mobile: string;
  province: string | null;
  ispName: string | null;
  faceValue: number;
  requestedProductType: RequestedProductType;
  matchedProductId: string;
  salePrice: number;
  purchasePrice: number;
  currency: string;
  mainStatus: MainOrderStatus;
  paymentStatus?: string | null;
  pieceNo?: number;
  pieceCount?: number;
  supplierStatus: SupplierOrderStatus;
  notifyStatus: OrderNotifyStatus;
  refundStatus: OrderRefundStatus;
  monitorStatus: OrderMonitorStatus;
  channelSnapshotJson: Record<string, unknown>;
  productSnapshotJson: Record<string, unknown>;
  callbackSnapshotJson: Record<string, unknown>;
  supplierRouteSnapshotJson: Record<string, unknown>;
  riskSnapshotJson: Record<string, unknown>;
  extJson: Record<string, unknown>;
  exceptionTag: string | null;
  remark: string | null;
  version: number;
  requestId: string;
  createdAt: string;
  updatedAt: string;
  warningDeadlineAt: string | null;
  expireDeadlineAt: string | null;
  finishedAt: string | null;
}

export interface OrderGroupRecord {
  id: string;
  orderNo: string;
  channelOrderNo: string;
  channelId: string;
  mobile: string;
  carrierCode: string | null;
  province: string | null;
  faceValueTotal: number;
  requestedProductType: RequestedProductType;
  totalSalePrice: number;
  totalPurchasePrice: number;
  currency: string;
  mainStatus: MainOrderStatus;
  supplierStatus: SupplierOrderStatus;
  notifyStatus: OrderNotifyStatus;
  refundStatus: OrderRefundStatus;
  monitorStatus: OrderMonitorStatus;
  failedReason: string | null;
  callbackUrl: string | null;
  splitResultJson: Record<string, unknown>;
  extJson: Record<string, unknown>;
  requestId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface OrderPieceRecord {
  orderNo: string;
  parentOrderNo: string | null;
  channelOrderNo: string;
  channelId: string;
  supplierId: string | null;
  productId: string;
  pieceNo: number;
  pieceCount: number;
  faceValue: number;
  salePrice: number;
  purchasePrice: number;
  mainStatus: MainOrderStatus;
  supplierStatus: SupplierOrderStatus;
  refundStatus: OrderRefundStatus;
  notifyStatus: OrderNotifyStatus;
  monitorStatus: OrderMonitorStatus;
  remark: string | null;
  exceptionTag: string | null;
  supplierOrderNo: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface OrderEventRecord {
  id: string;
  orderNo: string;
  eventType: string;
  sourceService: string;
  sourceNo: string | null;
  beforeStatusJson: Record<string, unknown>;
  afterStatusJson: Record<string, unknown>;
  payloadJson: Record<string, unknown>;
  idempotencyKey?: string | null;
  operator: string;
  requestId: string;
  occurredAt: string;
}

export interface OpenOrderRecord {
  orderNo: string;
  channelOrderNo: string;
  mobile: string;
  province: string | null;
  ispName: string | null;
  faceValue: number;
  matchedProductId: string | null;
  salePrice: number;
  currency: string;
  mainStatus: MainOrderStatus;
  supplierStatus: SupplierOrderStatus;
  notifyStatus: OrderNotifyStatus;
  refundStatus: OrderRefundStatus;
  requestedProductType: RequestedProductType;
  extJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface OpenOrderEventRecord {
  eventType: string;
  sourceNo: string | null;
  beforeStatusJson: Record<string, unknown>;
  afterStatusJson: Record<string, unknown>;
  occurredAt: string;
}

export interface OrderListFilters {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  startTime?: string | null;
  endTime?: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  orderNo?: string;
  channelOrderNo?: string;
  mobile?: string;
  channelId?: string;
  productId?: string;
  mainStatus?: string;
  supplierStatus?: string;
  notifyStatus?: string;
  refundStatus?: string;
  exceptionTag?: string;
  supplierOrderNo?: string;
}

export interface OrderEventListFilters {
  pageNum?: number;
  pageSize?: number;
  startTime?: string | null;
  endTime?: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
