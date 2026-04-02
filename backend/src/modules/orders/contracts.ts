import type { OrderRecord } from '@/modules/orders/orders.types';

export interface OrderContract {
  getOrderByNo(orderNo: string): Promise<OrderRecord>;
  getSupplierExecutionContext(orderNo: string): Promise<OrderRecord>;
  getNotificationContext(orderNo: string): Promise<OrderRecord>;
  getLedgerContext(orderNo: string): Promise<OrderRecord>;
}
