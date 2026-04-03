import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runSeed } from '@/database/seeds/0001_base.seed';
import { db } from '@/lib/sql';

const testLockDir = join(process.env.TMPDIR ?? '/tmp', 'docs-backend-integration-test.lock');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireIntegrationTestLock() {
  for (;;) {
    try {
      await mkdir(testLockDir);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      await sleep(50);
    }
  }
}

export async function releaseIntegrationTestLock() {
  await rm(testLockDir, { recursive: true, force: true });
}

export async function resetTestState() {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS supplier.supplier_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_order_no TEXT NOT NULL UNIQUE,
      request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      standard_status TEXT NOT NULL,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_no, supplier_id)
    )
  `);
  await db`
    TRUNCATE TABLE
      worker.worker_job_attempts,
      worker.worker_dead_letters,
      worker.worker_jobs,
      notification.notification_delivery_logs,
      notification.notification_dead_letters,
      notification.notification_tasks,
      iam.login_logs,
      iam.login_sessions,
      iam.operation_audit_logs,
      channel.channel_request_nonces,
      risk.risk_decisions,
      risk.risk_black_white_list,
      risk.risk_rules,
      supplier.supplier_reconcile_diffs,
      supplier.supplier_callback_logs,
      supplier.supplier_request_logs,
      supplier.supplier_orders,
      product.product_sync_logs,
      ordering.order_events,
      ordering.orders,
      ledger.account_ledgers
  `;

  await runSeed(db);
}

export async function forceWorkerJobsReady() {
  await db`
    UPDATE worker.worker_jobs
    SET
      next_run_at = NOW(),
      updated_at = NOW()
    WHERE status IN ('READY', 'RETRY_WAIT')
  `;
}
