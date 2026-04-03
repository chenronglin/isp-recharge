import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';

import { runSeed } from '@/database/seeds/0001_base.seed';
import { db, executeFile } from '@/lib/sql';
import { WorkerRepository } from '@/modules/worker/worker.repository';
import {
  acquireIntegrationTestLock,
  releaseIntegrationTestLock,
  resetTestState,
} from './test-support';

const migrationFiles = [
  join(import.meta.dir, '../src/database/migrations/0001_init_schemas.sql'),
  join(import.meta.dir, '../src/database/migrations/0002_add_login_sessions.sql'),
  join(import.meta.dir, '../src/database/migrations/0003_add_admin_security_logs.sql'),
];

async function rebuildManagedSchemas() {
  await db.unsafe(`
    DROP SCHEMA IF EXISTS iam CASCADE;
    DROP SCHEMA IF EXISTS channel CASCADE;
    DROP SCHEMA IF EXISTS product CASCADE;
    DROP SCHEMA IF EXISTS ordering CASCADE;
    DROP SCHEMA IF EXISTS supplier CASCADE;
    DROP SCHEMA IF EXISTS ledger CASCADE;
    DROP SCHEMA IF EXISTS risk CASCADE;
    DROP SCHEMA IF EXISTS notification CASCADE;
    DROP SCHEMA IF EXISTS worker CASCADE;
    DROP TABLE IF EXISTS public.app_migrations;
  `);

  for (const migrationFile of migrationFiles) {
    await executeFile(migrationFile);
  }
}

beforeAll(async () => {
  await acquireIntegrationTestLock();
  await rebuildManagedSchemas();
  await runSeed(db);
});

beforeEach(async () => {
  await resetTestState();
});

afterAll(async () => {
  await releaseIntegrationTestLock();
});

test('并发 claimReady 不会让同一个 READY 任务被领取两次', async () => {
  const writer = new WorkerRepository();
  const claimerA = new WorkerRepository();
  const claimerB = new WorkerRepository();

  const job = await writer.create({
    jobType: 'notification.deliver',
    businessKey: `claim-race-${Date.now()}`,
    payload: {
      taskNo: 'task-1',
    },
  });

  const [claimedByA, claimedByB] = await Promise.all([
    claimerA.claimReady(1),
    claimerB.claimReady(1),
  ]);
  const claimedIds = [...claimedByA, ...claimedByB].map((claimedJob) => claimedJob.id);

  expect(claimedIds).toEqual([job.id]);

  const storedJob = await writer.getById(job.id);

  expect(storedJob?.status).toBe('RUNNING');
});
