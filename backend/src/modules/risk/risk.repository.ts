import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import type { RiskDecisionRecord, RiskRule } from '@/modules/risk/risk.types';

export class RiskRepository {
  async listRules(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: RiskRule[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const sortByMap: Record<string, string> = {
      priority: 'priority',
      createdAt: 'created_at',
      ruleCode: 'rule_code',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'priority';
    const orderDirection = input.sortOrder === 'desc' ? 'DESC' : 'ASC';

    if (input.keyword?.trim()) {
      params.push(`%${input.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(`(rule_code ILIKE $${index} OR rule_name ILIKE $${index} OR rule_type ILIKE $${index})`);
    }

    if (input.status?.trim()) {
      params.push(input.status.trim());
      whereClauses.push(`status = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const rows = await db.unsafe<RiskRule[]>(
      `
        SELECT
          id,
          rule_code AS "ruleCode",
          rule_name AS "ruleName",
          rule_type AS "ruleType",
          config_json AS "configJson",
          priority,
          status
        FROM risk.risk_rules
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM risk.risk_rules
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => ({
        ...row,
        configJson: parseJsonValue(row.configJson, {}),
      })),
      total: total?.total ?? 0,
    };
  }

  async createRule(input: {
    ruleCode: string;
    ruleName: string;
    ruleType: string;
    configJson: Record<string, unknown>;
    priority: number;
  }): Promise<RiskRule> {
    const rows = await db<RiskRule[]>`
      INSERT INTO risk.risk_rules (
        id,
        rule_code,
        rule_name,
        rule_type,
        config_json,
        priority,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.ruleCode},
        ${input.ruleName},
        ${input.ruleType},
        ${JSON.stringify(input.configJson)},
        ${input.priority},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        rule_code AS "ruleCode",
        rule_name AS "ruleName",
        rule_type AS "ruleType",
        config_json AS "configJson",
        priority,
        status
    `;

    const rule = rows[0];

    if (!rule) {
      throw new Error('创建风控规则失败');
    }

    return {
      ...rule,
      configJson: parseJsonValue(rule.configJson, {}),
    };
  }

  async listBlackWhiteEntries(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    items: {
      id: string;
      entryType: string;
      targetValue: string;
      listType: string;
      status: string;
    }[];
    total: number;
  }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (input.keyword?.trim()) {
      params.push(`%${input.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(`(entry_type ILIKE $${index} OR target_value ILIKE $${index} OR list_type ILIKE $${index})`);
    }

    if (input.status?.trim()) {
      params.push(input.status.trim());
      whereClauses.push(`status = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const items = await db.unsafe<
      {
        id: string;
        entryType: string;
        targetValue: string;
        listType: string;
        status: string;
      }[]
    >(
      `
        SELECT
          id,
          entry_type AS "entryType",
          target_value AS "targetValue",
          list_type AS "listType",
          status
        FROM risk.risk_black_white_list
        ${whereSql}
        ORDER BY created_at ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM risk.risk_black_white_list
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items,
      total: total?.total ?? 0,
    };
  }

  async createBlackWhiteEntry(input: {
    entryType: string;
    targetValue: string;
    listType: string;
    remark?: string;
  }) {
    const rows = await db<
      {
        id: string;
        entryType: string;
        targetValue: string;
        listType: string;
        status: string;
        remark: string | null;
      }[]
    >`
      INSERT INTO risk.risk_black_white_list (
        id,
        entry_type,
        target_value,
        list_type,
        status,
        remark,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.entryType},
        ${input.targetValue},
        ${input.listType},
        'ACTIVE',
        ${input.remark ?? null},
        NOW()
      )
      ON CONFLICT (entry_type, target_value, list_type) DO UPDATE
      SET
        status = 'ACTIVE',
        remark = EXCLUDED.remark
      RETURNING
        id,
        entry_type AS "entryType",
        target_value AS "targetValue",
        list_type AS "listType",
        status,
        remark
    `;

    return rows[0] ?? null;
  }

  async findBlackWhiteEntry(entryType: string, targetValue: string) {
    return first<{ listType: string; status: string }>(db`
      SELECT
        list_type AS "listType",
        status
      FROM risk.risk_black_white_list
      WHERE entry_type = ${entryType}
        AND target_value = ${targetValue}
        AND status = 'ACTIVE'
      LIMIT 1
    `);
  }

  async findActiveRuleByCode(ruleCode: string): Promise<RiskRule | null> {
    const row = await first<RiskRule>(db<RiskRule[]>`
      SELECT
        id,
        rule_code AS "ruleCode",
        rule_name AS "ruleName",
        rule_type AS "ruleType",
        config_json AS "configJson",
        priority,
        status
      FROM risk.risk_rules
      WHERE rule_code = ${ruleCode}
        AND status = 'ACTIVE'
      LIMIT 1
    `);

    return row
      ? {
          ...row,
          configJson: parseJsonValue(row.configJson, {}),
        }
      : null;
  }

  async countRecentDecisions(input: { channelId: string; mobile: string; seconds: number }) {
    const row = await first<{ total: number }>(db<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM risk.risk_decisions
      WHERE channel_id = ${input.channelId}
        AND mobile = ${input.mobile}
        AND created_at >= NOW() - (${input.seconds} * INTERVAL '1 second')
    `);

    return Number(row?.total ?? 0);
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
  }): Promise<{ items: RiskDecisionRecord[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (input.keyword?.trim()) {
      params.push(`%${input.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(`(COALESCE(order_no, '') ILIKE $${index} OR COALESCE(channel_id, '') ILIKE $${index} OR reason ILIKE $${index})`);
    }

    if (input.status?.trim()) {
      params.push(input.status.trim());
      whereClauses.push(`decision = $${params.length}`);
    }

    if (input.startTime) {
      params.push(input.startTime);
      whereClauses.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (input.endTime) {
      params.push(input.endTime);
      whereClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const rows = await db.unsafe<RiskDecisionRecord[]>(
      `
        SELECT
          id,
          order_no AS "orderNo",
          channel_id AS "channelId",
          decision,
          reason,
          hit_rules_json AS "hitRules",
          context_json AS "contextJson",
          created_at AS "createdAt"
        FROM risk.risk_decisions
        ${whereSql}
        ORDER BY created_at ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM risk.risk_decisions
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => ({
        ...row,
        hitRules: parseJsonValue(row.hitRules, []),
        contextJson: parseJsonValue(row.contextJson, {}),
      })),
      total: total?.total ?? 0,
    };
  }

  async findRuleById(ruleId: string): Promise<RiskRule | null> {
    const row = await first<RiskRule>(db<RiskRule[]>`
      SELECT
        id,
        rule_code AS "ruleCode",
        rule_name AS "ruleName",
        rule_type AS "ruleType",
        config_json AS "configJson",
        priority,
        status
      FROM risk.risk_rules
      WHERE id = ${ruleId}
      LIMIT 1
    `);

    return row
      ? {
          ...row,
          configJson: parseJsonValue(row.configJson, {}),
        }
      : null;
  }

  async addDecision(input: {
    orderNo?: string;
    channelId: string;
    decision: string;
    reason: string;
    hitRules: string[];
    mobile?: string;
    ip?: string;
  }): Promise<void> {
    await db`
      INSERT INTO risk.risk_decisions (
        id,
        order_no,
        channel_id,
        mobile,
        ip,
        decision,
        reason,
        hit_rules_json,
        context_json,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.orderNo ?? null},
        ${input.channelId},
        ${input.mobile ?? null},
        ${input.ip ?? null},
        ${input.decision},
        ${input.reason},
        ${JSON.stringify(input.hitRules)},
        ${JSON.stringify({
          mobile: input.mobile ?? null,
          ip: input.ip ?? null,
        })},
        NOW()
      )
    `;
  }
}
