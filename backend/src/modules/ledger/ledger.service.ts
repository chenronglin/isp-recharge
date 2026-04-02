import { badRequest, notFound } from '@/lib/errors';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { LedgerRepository } from '@/modules/ledger/ledger.repository';

export class LedgerService implements LedgerContract {
  constructor(private readonly repository: LedgerRepository) {}

  async listAccounts() {
    return this.repository.listAccounts();
  }

  async listLedgerEntries() {
    return this.repository.listLedgerEntries();
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
