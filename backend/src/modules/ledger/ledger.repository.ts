import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { ledgerSql } from '@/modules/ledger/ledger.sql';
import type { Account, LedgerEntry } from '@/modules/ledger/ledger.types';

export class LedgerRepository {
  private async lockLedgerMutation(tx: typeof db, key: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private mapAccount(row: Account): Account {
    return {
      ...row,
      availableBalance: Number(row.availableBalance),
      frozenBalance: Number(row.frozenBalance),
    };
  }

  private mapLedgerEntry(row: LedgerEntry): LedgerEntry {
    return {
      ...row,
      amount: Number(row.amount),
      balanceBefore: Number(row.balanceBefore),
      balanceAfter: Number(row.balanceAfter),
    };
  }

  async listAccounts(): Promise<Account[]> {
    const rows = await db.unsafe<Account[]>(ledgerSql.listAccounts);
    return rows.map((row) => this.mapAccount(row));
  }

  async listLedgerEntries(): Promise<LedgerEntry[]> {
    const rows = await db.unsafe<LedgerEntry[]>(ledgerSql.listEntries);
    return rows.map((row) => this.mapLedgerEntry(row));
  }

  async findAccount(ownerType: string, ownerId: string): Promise<Account | null> {
    const row = await first<Account>(db<Account[]>`
      SELECT
        id,
        owner_type AS "ownerType",
        owner_id AS "ownerId",
        available_balance AS "availableBalance",
        frozen_balance AS "frozenBalance",
        currency,
        status
      FROM ledger.accounts
      WHERE owner_type = ${ownerType}
        AND owner_id = ${ownerId}
      LIMIT 1
    `);

    return row ? this.mapAccount(row) : null;
  }

  async findPlatformAccount(): Promise<Account | null> {
    return this.findAccount('PLATFORM', 'SYSTEM');
  }

  async ensureChannelAccount(channelId: string): Promise<Account> {
    await db`
      INSERT INTO ledger.accounts (
        id,
        owner_type,
        owner_id,
        available_balance,
        frozen_balance,
        currency,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        'CHANNEL',
        ${channelId},
        0,
        0,
        'CNY',
        'ACTIVE',
        NOW(),
        NOW()
      )
      ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
      SET
        status = 'ACTIVE',
        updated_at = NOW()
    `;

    const account = await this.findAccount('CHANNEL', channelId);

    if (!account) {
      throw new Error('渠道余额账户创建失败');
    }

    return account;
  }

  async findLedgerByReference(
    referenceType: string,
    referenceNo: string,
    actionType: string,
  ): Promise<LedgerEntry | null> {
    const row = await first<LedgerEntry>(db<LedgerEntry[]>`
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
      WHERE reference_type = ${referenceType}
        AND reference_no = ${referenceNo}
        AND action_type = ${actionType}
      LIMIT 1
    `);

    return row ? this.mapLedgerEntry(row) : null;
  }

  async findLedgerByOrderAction(orderNo: string, actionType: string): Promise<LedgerEntry | null> {
    const row = await first<LedgerEntry>(db<LedgerEntry[]>`
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
      WHERE order_no = ${orderNo}
        AND action_type = ${actionType}
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `);

    return row ? this.mapLedgerEntry(row) : null;
  }

  async transferBalance(input: {
    fromAccountId: string;
    toAccountId: string;
    orderNo: string;
    amount: number;
    referenceNo: string;
    actionType: string;
  }): Promise<{ referenceNo: string }> {
    return db.begin(async (tx) => {
      await this.lockLedgerMutation(
        tx,
        `ledger:${input.actionType}:ORDER:${input.orderNo}:${input.referenceNo}`,
      );

      const existing = await first<LedgerEntry>(tx<LedgerEntry[]>`
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
        WHERE order_no = ${input.orderNo}
          AND action_type = ${input.actionType}
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `);

      if (existing) {
        return {
          referenceNo: existing.referenceNo,
        };
      }

      const accountRows = await tx<Account[]>`
        SELECT
          id,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status
        FROM ledger.accounts
        WHERE id IN (${input.fromAccountId}, ${input.toAccountId})
        ORDER BY id ASC
        FOR UPDATE
      `;
      const fromAccount = accountRows.find((account) => account.id === input.fromAccountId);
      const toAccount = accountRows.find((account) => account.id === input.toAccountId);

      if (!fromAccount || !toAccount) {
        throw new Error('账户不存在');
      }

      const debitRows = await tx<
        {
          balanceBefore: string;
          balanceAfter: string;
        }[]
      >`
        UPDATE ledger.accounts
        SET
          available_balance = available_balance - ${input.amount},
          updated_at = NOW()
        WHERE id = ${fromAccount.id}
          AND available_balance >= ${input.amount}
        RETURNING
          (available_balance + ${input.amount})::text AS "balanceBefore",
          available_balance::text AS "balanceAfter"
      `;

      if (!debitRows[0]) {
        throw new Error('账户余额不足');
      }

      const creditRows = await tx<
        {
          balanceBefore: string;
          balanceAfter: string;
        }[]
      >`
        UPDATE ledger.accounts
        SET
          available_balance = available_balance + ${input.amount},
          updated_at = NOW()
        WHERE id = ${toAccount.id}
        RETURNING
          (available_balance - ${input.amount})::text AS "balanceBefore",
          available_balance::text AS "balanceAfter"
      `;

      const creditRow = creditRows[0];

      if (!creditRow) {
        throw new Error('账户不存在');
      }

      const debitRow = debitRows[0];

      await tx`
        INSERT INTO ledger.account_ledgers (
          id,
          ledger_no,
          account_id,
          order_no,
          action_type,
          direction,
          amount,
          currency,
          balance_before,
          balance_after,
          reference_type,
          reference_no,
          created_at
        )
        VALUES (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${fromAccount.id},
          ${input.orderNo},
          ${input.actionType},
          'DEBIT',
          ${input.amount},
          'CNY',
          ${debitRow.balanceBefore},
          ${debitRow.balanceAfter},
          'ORDER',
          ${input.referenceNo},
          NOW()
        ),
        (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${toAccount.id},
          ${input.orderNo},
          ${input.actionType},
          'CREDIT',
          ${input.amount},
          'CNY',
          ${creditRow.balanceBefore},
          ${creditRow.balanceAfter},
          'ORDER',
          ${input.referenceNo},
          NOW()
        )
      `;

      return {
        referenceNo: input.referenceNo,
      };
    });
  }

  async createSingleLedger(input: {
    accountId: string;
    orderNo?: string | null;
    actionType: string;
    direction: 'DEBIT' | 'CREDIT';
    amount: number;
    referenceType: string;
    referenceNo: string;
  }): Promise<{ referenceNo: string }> {
    return db.begin(async (tx) => {
      await this.lockLedgerMutation(
        tx,
        `ledger:${input.actionType}:${input.referenceType}:${input.referenceNo}`,
      );

      const existing = await first<LedgerEntry>(tx<LedgerEntry[]>`
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
        WHERE reference_type = ${input.referenceType}
          AND reference_no = ${input.referenceNo}
          AND action_type = ${input.actionType}
        LIMIT 1
      `);

      if (existing) {
        return {
          referenceNo: existing.referenceNo,
        };
      }

      const rows = await tx<Account[]>`
        SELECT
          id,
          owner_type AS "ownerType",
          owner_id AS "ownerId",
          available_balance AS "availableBalance",
          frozen_balance AS "frozenBalance",
          currency,
          status
        FROM ledger.accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      const account = rows[0];

      if (!account) {
        throw new Error('账户不存在');
      }

      const updatedRows = await tx<
        {
          balanceBefore: string;
          balanceAfter: string;
        }[]
      >`
        UPDATE ledger.accounts
        SET
          available_balance = CASE
            WHEN ${input.direction} = 'CREDIT' THEN available_balance + ${input.amount}
            ELSE available_balance - ${input.amount}
          END,
          updated_at = NOW()
        WHERE id = ${account.id}
          AND (${input.direction} = 'CREDIT' OR available_balance >= ${input.amount})
        RETURNING
          CASE
            WHEN ${input.direction} = 'CREDIT' THEN (available_balance - ${input.amount})::text
            ELSE (available_balance + ${input.amount})::text
          END AS "balanceBefore",
          available_balance::text AS "balanceAfter"
      `;

      const updatedRow = updatedRows[0];

      if (!updatedRow) {
        throw new Error('账户余额不足');
      }

      await tx`
        INSERT INTO ledger.account_ledgers (
          id,
          ledger_no,
          account_id,
          order_no,
          action_type,
          direction,
          amount,
          currency,
          balance_before,
          balance_after,
          reference_type,
          reference_no,
          created_at
        )
        VALUES (
          ${generateId()},
          ${generateBusinessNo('ledger')},
          ${account.id},
          ${input.orderNo ?? null},
          ${input.actionType},
          ${input.direction},
          ${input.amount},
          'CNY',
          ${updatedRow.balanceBefore},
          ${updatedRow.balanceAfter},
          ${input.referenceType},
          ${input.referenceNo},
          NOW()
        )
      `;

      return {
        referenceNo: input.referenceNo,
      };
    });
  }
}
