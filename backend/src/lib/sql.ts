import { SQL } from 'bun';

import { env } from '@/lib/env';

/**
 * Bun 原生 SQL 客户端统一实例。
 * 所有模块共享连接池，但仍通过 repository 保持查询边界清晰。
 */
const connectionString = `postgres://${env.postgres.username}:${env.postgres.password}@${env.postgres.hostname}:${env.postgres.port}/${env.postgres.database}`;

export const db = new SQL(connectionString);

export async function first<T>(promise: Promise<T[]>): Promise<T | null> {
  const rows = await promise;
  return rows[0] ?? null;
}

export async function many<T>(promise: Promise<T[]>): Promise<T[]> {
  return promise;
}

export async function executeFile(filePath: string): Promise<void> {
  await db.file(filePath);
}
