export interface Account {
  id: string;
  ownerType: string;
  ownerId: string;
  availableBalance: number;
  frozenBalance: number;
  currency: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LedgerEntry {
  id: string;
  ledgerNo: string;
  accountId: string;
  ownerType?: string;
  ownerId?: string;
  orderNo: string | null;
  actionType: string;
  direction: string;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string;
  referenceNo: string;
  createdAt: string;
}
