export const ledgerSql = {
  listAccounts: `
    SELECT
      id,
      owner_type AS "ownerType",
      owner_id AS "ownerId",
      available_balance AS "availableBalance",
      frozen_balance AS "frozenBalance",
      currency,
      status
    FROM ledger.accounts
    ORDER BY created_at DESC
  `,
  listEntries: `
    SELECT
      id,
      ledger_no AS "ledgerNo",
      account_id AS "accountId",
      order_no AS "orderNo",
      action_type AS "actionType",
      direction,
      amount,
      currency,
      balance_before AS "balanceBefore",
      balance_after AS "balanceAfter",
      reference_type AS "referenceType",
      reference_no AS "referenceNo",
      created_at AS "createdAt"
    FROM ledger.account_ledgers
    ORDER BY created_at DESC
  `,
} as const;
