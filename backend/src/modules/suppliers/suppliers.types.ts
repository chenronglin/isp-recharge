export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  baseUrl: string | null;
  protocolType: string;
  credentialMode: string;
  accessAccount: string | null;
  accessPasswordEncrypted: string | null;
  cooperationStatus: string;
  supportsBalanceQuery: boolean;
  supportsRechargeRecords: boolean;
  supportsConsumptionLog: boolean;
  remark: string | null;
  healthStatus: string;
  lastHealthCheckAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierConfig {
  id: string;
  supplierId: string;
  configJson: Record<string, unknown>;
  credentialEncrypted: string;
  callbackSecretEncrypted: string;
  timeoutMs: number;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierOrder {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierOrderNo: string;
  requestPayloadJson: Record<string, unknown>;
  responsePayloadJson: Record<string, unknown>;
  standardStatus: string;
  attemptNo: number;
  durationMs: number;
}

export interface SupplierCatalogItem {
  productCode: string;
  productName: string;
  carrierCode: string;
  provinceName: string;
  faceValue: number;
  rechargeMode: string;
  salesUnit?: string;
  status?: string;
  salesStatus?: string;
  purchasePrice: number;
  inventoryQuantity: number;
  supplierProductCode: string;
  routeType?: string;
  priority?: number;
  mappingStatus?: string;
}

export interface SupplierDynamicItem {
  productCode: string;
  salesStatus: string;
  purchasePrice: number;
  inventoryQuantity: number;
}

export interface SupplierSyncLog {
  id: string;
  supplierId: string;
  syncType: string;
  status: string;
  requestPayloadJson: Record<string, unknown>;
  responsePayloadJson: Record<string, unknown>;
  errorMessage: string | null;
  syncedAt: string;
}

export interface SupplierRequestLog {
  id: string;
  supplierId: string;
  orderNo: string | null;
  supplierProductCode: string | null;
  requestPayloadJson: Record<string, unknown>;
  responsePayloadJson: Record<string, unknown>;
  requestStatus: string;
  attemptNo: number;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierRuntimeBreaker {
  id: string;
  supplierId: string;
  breakerStatus: string;
  failCountWindow: number;
  failThreshold: number;
  openedAt: string | null;
  lastProbeAt: string | null;
  recoveryTimeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierReconcileCandidate {
  orderNo: string;
  supplierId: string;
  supplierOrderNo: string;
  platformMainStatus: string;
  platformSupplierStatus: string;
  refundStatus: string;
  supplierOrderStatus: string;
  purchasePrice: number;
  orderCreatedAt: string;
  orderUpdatedAt: string;
}

export interface SupplierReconcileDiff {
  id: string;
  supplierId: string;
  reconcileDate: string;
  orderNo: string | null;
  diffType: string;
  diffAmount: number;
  detailsJson: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierBalanceSnapshot {
  id: string;
  supplierId: string;
  balanceAmount: number;
  currency: string;
  balanceStatus: string;
  sourceType: string;
  queriedAt: string;
  rawPayloadJson: Record<string, unknown>;
}

export interface SupplierHealthCheck {
  id: string;
  supplierId: string;
  healthStatus: string;
  httpStatus: number | null;
  message: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  checkedAt: string;
}

export interface SupplierConsumptionLog {
  id: string;
  supplierId: string;
  mobile: string;
  orderNo: string | null;
  supplierOrderNo: string | null;
  amount: number;
  status: string;
  occurredAt: string;
  rawPayloadJson: Record<string, unknown>;
}

export interface SupplierRechargeRecord {
  id: string;
  supplierId: string;
  rechargeType: string;
  amount: number;
  currency: string;
  beforeBalance: number;
  afterBalance: number;
  recordSource: string;
  supplierTradeNo: string | null;
  remark: string | null;
  rawPayloadJson: Record<string, unknown>;
  status: string;
  operatorUserId: string | null;
  operatorUsername: string | null;
  syncedAt: string | null;
  createdAt: string;
}

export interface SupplierBalanceView {
  supplierId: string;
  balanceAmountFen: number;
  currency: string;
  balanceStatus: string;
  sourceType: string;
  queriedAt: string;
  rawPayload: Record<string, unknown>;
}
