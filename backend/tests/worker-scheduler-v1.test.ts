import { afterEach, expect, test } from 'bun:test';

import { buildApp } from '@/app';
import { db } from '@/lib/sql';
import { WorkerRepository } from '@/modules/worker/worker.repository';
import { WorkerService } from '@/modules/worker/worker.service';
import { resetTestState } from './test-support';

let runtime: Awaited<ReturnType<typeof buildApp>> | null = null;

afterEach(async () => {
  runtime?.stop();
  runtime = null;
  await resetTestState();
});

test('buildApp bootstraps one recurring job per supported task type', async () => {
  await resetTestState();
  runtime = await buildApp({ startWorkerScheduler: false });

  const rows = await db<{ jobType: string; count: number }[]>`
    SELECT
      job_type AS "jobType",
      COUNT(*)::int AS count
    FROM worker.worker_jobs
    WHERE job_type IN (
      'supplier.catalog.full-sync',
      'supplier.catalog.delta-sync',
      'order.timeout.scan',
      'supplier.reconcile.daily',
      'supplier.reconcile.inflight'
    )
    GROUP BY job_type
    ORDER BY job_type ASC
  `;

  expect(rows).toEqual([
    { jobType: 'order.timeout.scan', count: 1 },
    { jobType: 'supplier.catalog.delta-sync', count: 1 },
    { jobType: 'supplier.catalog.full-sync', count: 1 },
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
      'supplier.catalog.full-sync',
      'supplier.catalog.delta-sync',
      'order.timeout.scan',
      'supplier.reconcile.daily',
      'supplier.reconcile.inflight'
    )
    GROUP BY job_type
    ORDER BY job_type ASC
  `;

  expect(rows).toEqual([
    { jobType: 'order.timeout.scan', count: 1 },
    { jobType: 'supplier.catalog.delta-sync', count: 1 },
    { jobType: 'supplier.catalog.full-sync', count: 1 },
    { jobType: 'supplier.reconcile.daily', count: 1 },
    { jobType: 'supplier.reconcile.inflight', count: 1 },
  ]);
});

test('successful recurring task execution reschedules the same job instead of ending at SUCCESS', async () => {
  await resetTestState();
  const repository = new WorkerRepository();
  const service = new WorkerService(repository);
  let handledCount = 0;

  service.registerHandler('order.timeout.scan', async () => {
    handledCount += 1;
  });

  const job = await repository.create({
    jobType: 'order.timeout.scan',
    businessKey: 'system:order-timeout-scan',
    payload: {},
    nextRunAt: new Date(),
  });

  await service.processReadyJobs(1);

  const storedJob = await repository.getById(job.id);

  expect(handledCount).toBe(1);
  expect(storedJob?.status).toBe('READY');
  expect(storedJob?.attemptCount).toBe(0);
  expect(new Date(String(storedJob?.nextRunAt)).getTime()).toBeGreaterThan(Date.now() - 1000);
});
