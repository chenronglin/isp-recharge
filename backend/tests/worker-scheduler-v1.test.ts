import { afterEach, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';
import { resetTestState } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>> | null = null;

afterEach(async () => {
  runtime?.stop();
  runtime = null;
  await resetTestState();
});

test('buildApp bootstraps one safe recurring job per supported task type', async () => {
  await resetTestState();
  runtime = await buildApp({ startWorkerScheduler: false });

  const rows = await db<{ jobType: string; count: number }[]>`
    SELECT
      job_type AS "jobType",
      COUNT(*)::int AS count
    FROM worker.worker_jobs
    WHERE job_type IN (
      'order.timeout.scan',
      'supplier.reconcile.daily',
      'supplier.reconcile.inflight'
    )
    GROUP BY job_type
    ORDER BY job_type ASC
  `;

  expect(rows).toEqual([
    { jobType: 'order.timeout.scan', count: 1 },
    { jobType: 'supplier.reconcile.daily', count: 1 },
    { jobType: 'supplier.reconcile.inflight', count: 1 },
  ]);
});

test('bootstrapping recurring schedules twice keeps jobs singleton', async () => {
  await resetTestState();
  runtime = await buildApp({ startWorkerScheduler: false });

  await runtime.services.worker.bootstrapRecurringSchedules();

  const rows = await db<{ jobType: string; count: number }[]>`
    SELECT
      job_type AS "jobType",
      COUNT(*)::int AS count
    FROM worker.worker_jobs
    WHERE job_type IN (
      'order.timeout.scan',
      'supplier.reconcile.daily',
      'supplier.reconcile.inflight'
    )
    GROUP BY job_type
    ORDER BY job_type ASC
  `;

  expect(rows).toEqual([
    { jobType: 'order.timeout.scan', count: 1 },
    { jobType: 'supplier.reconcile.daily', count: 1 },
    { jobType: 'supplier.reconcile.inflight', count: 1 },
  ]);
});
