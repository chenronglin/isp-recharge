import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '@/lib/logger';
import { db, executeFile } from '@/lib/sql';

const migrationsDir = join(import.meta.dir, 'migrations');
const managedSchemas = [
  'iam',
  'channel',
  'product',
  'ordering',
  'supplier',
  'ledger',
  'risk',
  'notification',
  'worker',
] as const;

async function resetManagedSchemas(): Promise<void> {
  await db.unsafe(`
    DROP SCHEMA IF EXISTS ${managedSchemas.join(' CASCADE; DROP SCHEMA IF EXISTS ')} CASCADE;
    DROP TABLE IF EXISTS public.app_migrations;
  `);
}

async function ensureMigrationTable(): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS public.app_migrations (
      version TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.simple();
}

async function main(): Promise<void> {
  logger.info('重置数据库受管 Schema', { schemas: managedSchemas });
  await resetManagedSchemas();
  await ensureMigrationTable();
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    logger.info('执行数据库迁移', { version: file });

    await executeFile(filePath);
    await db`
      INSERT INTO public.app_migrations (version)
      VALUES (${file})
    `;
  }

  logger.info('数据库迁移完成');
  await db.close();
}

await main();
