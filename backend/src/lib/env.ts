/**
 * 环境变量统一解析。
 * 这里不依赖第三方库，直接使用 Bun.env，保证启动时就能发现配置缺失问题。
 */
const requiredKeys = [
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'ADMIN_JWT_SECRET',
  'INTERNAL_JWT_SECRET',
  'APP_ENCRYPTION_KEY',
] as const;

type RequiredKey = (typeof requiredKeys)[number];

function readEnv(key: RequiredKey): string {
  const value = Bun.env[key];

  if (!value) {
    throw new Error(`缺少必要环境变量: ${key}`);
  }

  return value;
}

function parseHost(host: string): { hostname: string; port: number } {
  const [hostname, portText] = host.split(':');

  if (!hostname || !portText) {
    throw new Error(`POSTGRES_HOST 格式非法，应为 host:port，当前值: ${host}`);
  }

  const port = Number(portText);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`POSTGRES_HOST 端口非法，当前值: ${host}`);
  }

  return { hostname, port };
}

const postgres = parseHost(readEnv('POSTGRES_HOST'));

export const env = {
  appHost: Bun.env.APP_HOST ?? '0.0.0.0',
  appPort: Number(Bun.env.APP_PORT ?? '3000'),
  appEnv: Bun.env.APP_ENV ?? 'development',
  postgres: {
    hostname: postgres.hostname,
    port: postgres.port,
    username: readEnv('POSTGRES_USER'),
    password: readEnv('POSTGRES_PASSWORD'),
    database: readEnv('POSTGRES_DB'),
    ssl: 'disable' as const,
    max: 10,
  },
  adminJwtSecret: readEnv('ADMIN_JWT_SECRET'),
  internalJwtSecret: readEnv('INTERNAL_JWT_SECRET'),
  encryptionKey: readEnv('APP_ENCRYPTION_KEY'),
  seed: {
    adminUsername: Bun.env.SEED_ADMIN_USERNAME ?? 'admin',
    adminPassword: Bun.env.SEED_ADMIN_PASSWORD ?? 'Admin123!',
    adminDisplayName: Bun.env.SEED_ADMIN_DISPLAY_NAME ?? '平台超级管理员',
    channelCode: Bun.env.SEED_CHANNEL_CODE ?? 'demo-channel',
    accessKey: Bun.env.SEED_ACCESS_KEY ?? 'demo-access-key',
    secretKey: Bun.env.SEED_SECRET_KEY ?? 'demo-secret-key',
    supplierCode: Bun.env.SEED_SUPPLIER_CODE ?? 'mock-supplier',
  },
};
