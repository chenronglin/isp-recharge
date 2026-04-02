export const riskSql = {
  listRules: `
    SELECT
      id,
      rule_code AS "ruleCode",
      rule_name AS "ruleName",
      rule_type AS "ruleType",
      config_json AS "configJson",
      priority,
      status
    FROM risk.risk_rules
    ORDER BY priority ASC, created_at DESC
  `,
  listBlackWhite: `
    SELECT
      id,
      entry_type AS "entryType",
      target_value AS "targetValue",
      list_type AS "listType",
      status
    FROM risk.risk_black_white_list
    ORDER BY created_at DESC
  `,
} as const;
