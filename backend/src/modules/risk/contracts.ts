import type { RiskDecision } from '@/modules/risk/risk.types';

export interface RiskContract {
  preCheck(input: {
    channelId: string;
    orderNo?: string;
    amount: number;
    ip?: string;
    mobile?: string;
  }): Promise<RiskDecision>;
}
