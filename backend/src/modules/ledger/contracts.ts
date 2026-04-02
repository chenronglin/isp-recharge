export interface LedgerContract {
  ensureBalanceSufficient(input: { channelId: string; amount: number }): Promise<void>;
  debitOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }>;
  refundOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }>;
  confirmOrderProfit(input: {
    orderNo: string;
    salePrice: number;
    purchasePrice: number;
  }): Promise<void>;
}
