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
  orderNo: string;
  channelOrderNo: string;
  channelId: string;
  parentChannelId: string | null;
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
  matchedProductId: string;
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
