export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  protocolType: string;
  status: string;
}

export interface SupplierConfig {
  id: string;
  supplierId: string;
  configJson: Record<string, unknown>;
  credentialEncrypted: string;
  callbackSecretEncrypted: string;
  timeoutMs: number;
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
