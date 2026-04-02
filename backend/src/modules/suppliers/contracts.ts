import type {
  SupplierCatalogItem,
  SupplierDynamicItem,
  SupplierReconcileDiff,
  SupplierSyncLog,
} from '@/modules/suppliers/suppliers.types';
import type { SupplierBalanceResult } from '@/modules/suppliers/adapters/types';

export interface SupplierContract {
  getSupplierBalance(input: { supplierId: string }): Promise<SupplierBalanceResult>;
  triggerCatalogSync(input: { supplierId: string }): Promise<{
    supplierCode: string;
    syncedProducts: string[];
  }>;
  listSyncLogs(input: { supplierId: string }): Promise<SupplierSyncLog[]>;
  syncFullCatalog(input: {
    supplierCode: string;
    items: SupplierCatalogItem[];
  }): Promise<{ syncedProducts: string[] }>;
  syncDynamicCatalog(input: {
    supplierCode: string;
    items: SupplierDynamicItem[];
  }): Promise<{ updatedProducts: string[] }>;
  submitOrder(payload: { orderNo: string }): Promise<void>;
  queryOrder(payload: {
    orderNo: string;
    supplierOrderNo: string;
    attemptIndex: number;
  }): Promise<void>;
  runInflightReconcile(): Promise<SupplierReconcileDiff[]>;
  runDailyReconcile(input?: { reconcileDate?: string }): Promise<SupplierReconcileDiff[]>;
}
