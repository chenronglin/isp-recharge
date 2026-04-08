import type { RiskContract } from '@/modules/risk/contracts';
import type { RiskRepository } from '@/modules/risk/risk.repository';
import { notFound } from '@/lib/errors';
import { toIsoDateTime } from '@/lib/utils';

export class RiskService implements RiskContract {
  constructor(private readonly repository: RiskRepository) {}

  private async persistDecision(input: {
    orderNo?: string;
    channelId: string;
    decision: 'PASS' | 'REJECT';
    reason: string;
    hitRules: string[];
    mobile?: string;
    ip?: string;
  }) {
    await this.repository.addDecision({
      orderNo: input.orderNo,
      channelId: input.channelId,
      decision: input.decision,
      reason: input.reason,
      hitRules: input.hitRules,
      mobile: input.mobile,
      ip: input.ip,
    });
  }

  async listRules(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    return this.repository.listRules(input);
  }

  async createRule(input: {
    ruleCode: string;
    ruleName: string;
    ruleType: string;
    configJson: Record<string, unknown>;
    priority?: number;
  }) {
    return this.repository.createRule({
      ...input,
      priority: input.priority ?? 1,
    });
  }

  async listBlackWhiteEntries(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    return this.repository.listBlackWhiteEntries(input);
  }

  async createBlackWhiteEntry(input: {
    entryType: string;
    targetValue: string;
    listType: string;
    remark?: string;
  }) {
    return this.repository.createBlackWhiteEntry(input);
  }

  async listDecisions(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listDecisions(input);
    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      })),
      total: result.total,
    };
  }

  async getRuleDetail(ruleId: string) {
    const rule = await this.repository.findRuleById(ruleId);

    if (!rule) {
      throw notFound('风控规则不存在');
    }

    return rule;
  }

  async preCheck(input: {
    channelId: string;
    orderNo?: string;
    amount: number;
    ip?: string;
    mobile?: string;
  }) {
    const hitRules: string[] = [];
    const whiteChannel = await this.repository.findBlackWhiteEntry('CHANNEL', input.channelId);

    if (whiteChannel?.listType === 'WHITE') {
      const decision = {
        decision: 'PASS' as const,
        reason: '命中白名单渠道',
        hitRules: ['WHITE_CHANNEL'],
      };

      await this.persistDecision({ ...input, ...decision });

      return decision;
    }

    const blackChannel = await this.repository.findBlackWhiteEntry('CHANNEL', input.channelId);

    if (blackChannel?.listType === 'BLACK') {
      const decision = {
        decision: 'REJECT' as const,
        reason: '命中渠道黑名单',
        hitRules: ['BLACK_CHANNEL'],
      };

      await this.persistDecision({ ...input, ...decision });

      return decision;
    }

    const blackIp = input.ip ? await this.repository.findBlackWhiteEntry('IP', input.ip) : null;

    if (blackIp?.listType === 'BLACK') {
      const decision = {
        decision: 'REJECT' as const,
        reason: '命中 IP 黑名单',
        hitRules: ['BLACK_IP'],
      };

      await this.persistDecision({ ...input, ...decision });

      return decision;
    }

    const blackMobile = input.mobile
      ? await this.repository.findBlackWhiteEntry('MOBILE', input.mobile)
      : null;

    if (blackMobile?.listType === 'BLACK') {
      const decision = {
        decision: 'REJECT' as const,
        reason: '命中手机号黑名单',
        hitRules: ['BLACK_MOBILE'],
      };

      await this.persistDecision({ ...input, ...decision });

      return decision;
    }

    const rules = await this.repository.listRules({
      pageNum: 1,
      pageSize: 100,
      sortBy: 'priority',
      sortOrder: 'asc',
    });
    const amountRule = rules.items.find(
      (rule) => rule.ruleCode === 'AMOUNT_REJECT' && rule.status === 'ACTIVE',
    );

    if (amountRule) {
      const threshold = Number(amountRule.configJson.threshold ?? 0);

      if (input.amount >= threshold) {
        hitRules.push(amountRule.ruleCode);
        const decision = {
          decision: 'REJECT' as const,
          reason: '订单金额触发风控拒绝',
          hitRules,
        };

        await this.persistDecision({ ...input, ...decision });

        return decision;
      }
    }

    const frequencyRule = await this.repository.findActiveRuleByCode('MOBILE_FREQUENCY_REJECT');

    if (frequencyRule && input.mobile) {
      const seconds = Number(frequencyRule.configJson.seconds ?? 60);
      const threshold = Number(frequencyRule.configJson.threshold ?? 0);
      const recentCount = await this.repository.countRecentDecisions({
        channelId: input.channelId,
        mobile: input.mobile,
        seconds,
      });

      if (recentCount >= threshold) {
        hitRules.push(frequencyRule.ruleCode);
        const decision = {
          decision: 'REJECT' as const,
          reason: '手机号频率触发风控拒绝',
          hitRules,
        };

        await this.persistDecision({ ...input, ...decision });

        return decision;
      }
    }

    const decision = {
      decision: 'PASS' as const,
      reason: '风控通过',
      hitRules,
    };

    await this.persistDecision({ ...input, ...decision });

    return decision;
  }
}
