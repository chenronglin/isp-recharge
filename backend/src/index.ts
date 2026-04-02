import { buildApp } from '@/app';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const runtime = await buildApp({
  startWorkerScheduler: true,
});

runtime.app.listen(env.appPort, () => {
  logger.info('API 服务启动成功', {
    host: env.appHost,
    port: env.appPort,
  });
});
