import { badRequest, notFound } from '@/lib/errors';
import { toAmountFen, toIsoDateTime } from '@/lib/utils';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { LedgerRepository } from '@/modules/ledger/ledger.repository';

export class LedgerService implements LedgerContract {
  constructor(private readonly repository: LedgerRepository) {}

  private toAccountDto(account: {
    id: string;
    ownerType: string;
    ownerId: string;
    availableBalance: number;
    frozenBalance: number;
    currency: string;
    status: string;
    createdAt?: string;
    updatedAt?: string;
  }) {
    return {
      id: account.id,
      ownerType: account.ownerType,
      ownerId: account.ownerId,
      availableBalanceFen: toAmountFen(account.availableBalance) ?? 0,
      frozenBalanceFen: toAmountFen(account.frozenBalance) ?? 0,
      currency: account.currency,
      status: account.status,
      createdAt: toIsoDateTime(account.createdAt),
      updatedAt: toIsoDateTime(account.updatedAt),
    };
  }

  private toLedgerEntryDto(entry: {
    id: string;
    ledgerNo: string;
    accountId: string;
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
  }) {
    return {
      id: entry.id,
      ledgerNo: entry.ledgerNo,
      accountId: entry.accountId,
      orderNo: entry.orderNo,
      actionType: entry.actionType,
      direction: entry.direction,
      amountFen: toAmountFen(entry.amount) ?? 0,
      currency: entry.currency,
      balanceBeforeFen: toAmountFen(entry.balanceBefore) ?? 0,
      balanceAfterFen: toAmountFen(entry.balanceAfter) ?? 0,
      referenceType: entry.referenceType,
      referenceNo: entry.referenceNo,
      createdAt: toIsoDateTime(entry.createdAt) ?? entry.createdAt,
    };
  }

  async listAccounts(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listAccounts(input);
    return {
      items: result.items.map((item) => this.toAccountDto(item)),
      total: result.total,
    };
  }

  async getAccountById(accountId: string) {
    const account = await this.repository.findAccountById(accountId);

    if (!account) {
      throw notFound('账户不存在');
    }

    return this.toAccountDto(account);
  }

  async listLedgerEntries(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    startTime?: string | null;
    endTime?: string | null;
    accountId?: string;
    orderNo?: string;
    channelId?: string;
    entryType?: string;
    bizNo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listLedgerEntries(input);
    return {
      items: result.items.map((item) => this.toLedgerEntryDto(item)),
      total: result.total,
    };
  }

  async getLedgerEntryById(entryId: string) {
    const entry = await this.repository.findLedgerEntryById(entryId);

    if (!entry) {
      throw notFound('账务流水不存在');
    }

    return this.toLedgerEntryDto(entry);
  }

  async rechargeChannelBalance(input: {
    channelId: string;
    amount: number;
    referenceNo: string;
  }): Promise<{ referenceNo: string }> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw badRequest('充值金额必须大于 0');
    }

    const channelAccount = await this.repository.ensureChannelAccount(input.channelId);

    return this.repository.createSingleLedger({
      accountId: channelAccount.id,
      orderNo: null,
      actionType: 'CHANNEL_RECHARGE',
      direction: 'CREDIT',
      amount: Number(input.amount),
      referenceType: 'CHANNEL_RECHARGE',
      referenceNo: input.referenceNo,
    });
  }

  async ensureBalanceSufficient(input: { channelId: string; amount: number }): Promise<void> {
    const channelAccount = await this.repository.findAccount('CHANNEL', input.channelId);

    if (!channelAccount) {
      throw notFound('渠道余额账户不存在');
    }

    if (channelAccount.availableBalance < input.amount) {
      throw badRequest('渠道余额不足');
    }
  }

  async debitOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }> {
    const existing = await this.repository.findLedgerByOrderAction(input.orderNo, 'ORDER_DEBIT');

    if (existing) {
      return {
        referenceNo: existing.referenceNo,
      };
    }

    const channelAccount = await this.repository.findAccount('CHANNEL', input.channelId);
    const platformAccount = await this.repository.findPlatformAccount();

    if (!channelAccount || !platformAccount) {
      throw notFound('余额账户不存在');
    }

    return this.repository.transferBalance({
      fromAccountId: channelAccount.id,
      toAccountId: platformAccount.id,
      orderNo: input.orderNo,
      amount: input.amount,
      referenceNo: input.orderNo,
      actionType: 'ORDER_DEBIT',
    });
  }

  async refundOrderAmount(input: {
    channelId: string;
    orderNo: string;
    amount: number;
  }): Promise<{ referenceNo: string }> {
    const existing = await this.repository.findLedgerByOrderAction(input.orderNo, 'ORDER_REFUND');

    if (existing) {
      return {
        referenceNo: existing.referenceNo,
      };
    }

    const channelAccount = await this.repository.findAccount('CHANNEL', input.channelId);
    const platformAccount = await this.repository.findPlatformAccount();

    if (!channelAccount || !platformAccount) {
      throw notFound('余额账户不存在');
    }

    return this.repository.transferBalance({
      fromAccountId: platformAccount.id,
      toAccountId: channelAccount.id,
      orderNo: input.orderNo,
      amount: input.amount,
      referenceNo: input.orderNo,
      actionType: 'ORDER_REFUND',
    });
  }

  async confirmOrderProfit(input: {
    orderNo: string;
    salePrice: number;
    purchasePrice: number;
  }): Promise<void> {
    const existing = await this.repository.findLedgerByOrderAction(input.orderNo, 'ORDER_PROFIT');

    if (existing) {
      return;
    }

    const profitAmount = Number((input.salePrice - input.purchasePrice).toFixed(2));

    if (profitAmount === 0) {
      return;
    }

    const platformAccount = await this.repository.findPlatformAccount();

    if (!platformAccount) {
      throw notFound('平台账户不存在');
    }

    await this.repository.createSingleLedger({
      accountId: platformAccount.id,
      orderNo: input.orderNo,
      actionType: 'ORDER_PROFIT',
      direction: profitAmount > 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(profitAmount),
      referenceType: 'ORDER',
      referenceNo: input.orderNo,
    });
  }
}
