import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '@/lib/logger';
import { db } from '@/lib/sql';

const seedsDir = join(import.meta.dir, 'seeds');

async function main(): Promise<void> {
  const files = (await readdir(seedsDir)).filter((file) => file.endsWith('.ts')).sort();

  for (const file of files) {
    logger.info('执行数据库种子', { file });
    const modulePath = join(seedsDir, file);
    const seedModule = await import(modulePath);
    await seedModule.runSeed(db);
  }

  logger.info('数据库种子执行完成');
  await db.close();
}

await main();
