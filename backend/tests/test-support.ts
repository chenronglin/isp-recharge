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
  await db`
    TRUNCATE TABLE
      worker.worker_job_artifacts,
      worker.worker_job_items,
      worker.worker_job_attempts,
      worker.worker_dead_letters,
      worker.worker_jobs,
      notification.notification_delivery_logs,
      notification.notification_dead_letters,
      notification.notification_tasks,
      iam.user_role_relations,
      iam.login_logs,
      iam.login_sessions,
      iam.operation_audit_logs,
      channel.portal_login_logs,
      channel.portal_login_sessions,
      channel.channel_recharge_records,
      channel.channel_request_nonces,
      channel.channel_split_policies,
      channel.channel_callback_configs,
      channel.channel_limit_rules,
      channel.channel_price_policies,
      channel.channel_product_authorizations,
      channel.channel_api_credentials,
      risk.risk_black_white_list,
      risk.risk_decisions,
      risk.risk_rules,
      supplier.supplier_recharge_records,
      supplier.supplier_consumption_logs,
      supplier.supplier_health_checks,
      supplier.supplier_balance_snapshots,
      supplier.supplier_reconcile_diffs,
      supplier.supplier_runtime_breakers,
      supplier.supplier_callback_logs,
      supplier.supplier_request_logs,
      supplier.supplier_orders,
      supplier.supplier_configs,
      product.product_supplier_mappings,
      product.product_sync_logs,
      ordering.order_groups,
      ordering.order_events,
      ordering.orders,
      ledger.account_ledgers,
      ledger.accounts,
      product.mobile_segments,
      product.recharge_products,
      supplier.suppliers,
      channel.channels,
      iam.roles,
      iam.admin_users
    RESTART IDENTITY CASCADE
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
