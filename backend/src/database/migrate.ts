import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '@/lib/logger';
import { db, executeFile } from '@/lib/sql';

const migrationsDir = join(import.meta.dir, 'migrations');

async function ensureMigrationTable(): Promise<void> {
  await db`
    CREATE TABLE IF NOT EXISTS public.app_migrations (
      version TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.simple();
}

async function readExecutedVersions(): Promise<Set<string>> {
  const rows = await db<{ version: string }[]>`
    SELECT version
    FROM public.app_migrations
    ORDER BY version ASC
  `;

  return new Set(rows.map((row) => row.version));
}

async function main(): Promise<void> {
  await ensureMigrationTable();

  const executed = await readExecutedVersions();
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (executed.has(file)) {
      continue;
    }

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
