export interface SupplierBalanceResult {
  agentAccount: string;
  agentName?: string;
  agentBalance: number;
  agentProfit?: number;
  errorCode: number;
  errorDesc?: string;
}

export interface SupplierCatalogSyncResult {
  items: Array<{
    productCode: string;
    productName: string;
    carrierCode: string;
    provinceName: string;
    faceValue: number;
    rechargeMode: string;
    purchasePrice: number;
    inventoryQuantity: number;
    supplierProductCode: string;
    salesStatus?: string;
    routeType?: string;
    priority?: number;
    mappingStatus?: string;
  }>;
}

export interface SupplierAdapter {
  readonly code: string;
  getBalance?(): Promise<SupplierBalanceResult>;
  syncCatalog?(): Promise<SupplierCatalogSyncResult>;
  submitOrder(input: {
    orderNo: string;
    productId: string;
    supplierProductCode: string;
    mobile?: string;
    faceValue?: number;
    ispName?: string;
    province?: string;
    callbackUrl?: string;
  }): Promise<{
    supplierOrderNo: string;
    status: 'ACCEPTED' | 'PROCESSING';
    rawCode?: number;
    rawMessage?: string;
  }>;
  queryOrder(input: { supplierOrderNo: string; attemptIndex: number; orderNo?: string }): Promise<{
    status: 'QUERYING' | 'SUCCESS' | 'FAIL';
    reason?: string;
    rawStatusCode?: string;
  }>;
  parseCallback(input: {
    headers?: Record<string, unknown>;
    body: Record<string, unknown>;
    rawBody?: string;
    contentType?: string;
  }): Promise<{
    supplierOrderNo: string;
    status: 'SUCCESS' | 'FAIL';
    reason?: string;
  }>;
}

export type MockSupplierMode = 'mock-auto-success' | 'mock-auto-fail';
