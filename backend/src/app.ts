import { cors } from '@elysiajs/cors';
import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';

import { env } from '@/lib/env';
import { eventBus } from '@/lib/event-bus';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import { createChannelsModule } from '@/modules/channels';
import { createIamModule } from '@/modules/iam';
import { createLedgerModule } from '@/modules/ledger';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { LedgerService } from '@/modules/ledger/ledger.service';
import { createNotificationsModule } from '@/modules/notifications';
import { createOrdersModule } from '@/modules/orders';
import { createProductsModule } from '@/modules/products';
import { createRiskModule } from '@/modules/risk';
import { createSuppliersModule } from '@/modules/suppliers';
import { createWorkerModule } from '@/modules/worker';
import { createAuthPlugin } from '@/plugins/auth.plugin';
import { createErrorPlugin } from '@/plugins/error.plugin';
import { createRequestContextPlugin } from '@/plugins/request-context.plugin';

interface BuildAppOptions {
  startWorkerScheduler?: boolean;
}

const localAdminOrigins = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

function createLedgerContractProxy(getService: () => LedgerService): LedgerContract {
  return {
    ensureBalanceSufficient(input) {
      return getService().ensureBalanceSufficient(input);
    },
    debitOrderAmount(input) {
      return getService().debitOrderAmount(input);
    },
    refundOrderAmount(input) {
      return getService().refundOrderAmount(input);
    },
    confirmOrderProfit(input) {
      return getService().confirmOrderProfit(input);
    },
  };
}

export async function buildApp(options: BuildAppOptions = {}) {
  eventBus.clear();

  const iamModule = createIamModule();
  const workerModule = createWorkerModule(iamModule.service);
  const channelsModule = createChannelsModule(iamModule.service);
  const productsModule = createProductsModule(iamModule.service, channelsModule.service);
  const riskModule = createRiskModule(iamModule.service);
  let ledgerServiceRef: LedgerService | null = null;
  const ledgerContract = createLedgerContractProxy(() => {
    if (!ledgerServiceRef) {
      throw new Error('账务服务尚未完成初始化');
    }

    return ledgerServiceRef;
  });
  const ordersModule = createOrdersModule({
    channelContract: channelsModule.contract,
    productContract: productsModule.contract,
    riskContract: riskModule.contract,
    ledgerContract,
    workerContract: workerModule.contract,
    channelsService: channelsModule.service,
    iamService: iamModule.service,
  });
  const ledgerModule = createLedgerModule(iamModule.service);
  ledgerServiceRef = ledgerModule.service;

  const suppliersModule = createSuppliersModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    workerContract: workerModule.contract,
  });
  const notificationsModule = createNotificationsModule({
    iamService: iamModule.service,
    orderContract: ordersModule.contract,
    workerContract: workerModule.contract,
  });

  // 统一注册 Worker 处理器。
  workerModule.service.registerHandler('supplier.catalog.full-sync', async (payload) => {
    await suppliersModule.service.syncFullCatalog({
      supplierCode: String(payload.supplierCode ?? ''),
      items: Array.isArray(payload.items) ? (payload.items as any[]) : [],
    });
  });
  workerModule.service.registerHandler('supplier.catalog.delta-sync', async (payload) => {
    await suppliersModule.service.syncDynamicCatalog({
      supplierCode: String(payload.supplierCode ?? ''),
      items: Array.isArray(payload.items) ? (payload.items as any[]) : [],
    });
  });
  workerModule.service.registerHandler('supplier.submit', (payload) =>
    suppliersModule.service.submitOrder({
      orderNo: String(payload.orderNo ?? ''),
    }),
  );
  workerModule.service.registerHandler('supplier.query', (payload) =>
    suppliersModule.service.queryOrder({
      orderNo: String(payload.orderNo ?? ''),
      supplierOrderNo: String(payload.supplierOrderNo ?? ''),
      attemptIndex: Number(payload.attemptIndex ?? 0),
    }),
  );
  workerModule.service.registerHandler('supplier.reconcile.inflight', async () => {
    await suppliersModule.service.runInflightReconcile();
  });
  workerModule.service.registerHandler('supplier.reconcile.daily', async (payload) => {
    await suppliersModule.service.runDailyReconcile({
      reconcileDate: typeof payload.reconcileDate === 'string' ? payload.reconcileDate : undefined,
    });
  });
  workerModule.service.registerHandler('order.timeout.scan', async (payload) => {
    const requestedNow = typeof payload.now === 'string' ? new Date(payload.now) : new Date();
    const scanNow = Number.isNaN(requestedNow.getTime()) ? new Date() : requestedNow;

    await ordersModule.service.scanTimeouts(scanNow);
  });
  workerModule.service.registerHandler('notification.deliver', (payload) =>
    notificationsModule.service.handleDeliverJob(payload),
  );

  // 统一注册领域事件订阅。
  eventBus.subscribe('SupplierAccepted', (payload) =>
    ordersModule.service.handleSupplierAccepted(payload),
  );
  eventBus.subscribe('SupplierSucceeded', (payload) =>
    ordersModule.service.handleSupplierSucceeded(payload),
  );
  eventBus.subscribe('SupplierFailed', (payload) =>
    ordersModule.service.handleSupplierFailed(payload),
  );
  eventBus.subscribe('NotificationRequested', (payload) =>
    notificationsModule.service.handleNotificationRequested(payload),
  );
  eventBus.subscribe('NotificationSucceeded', (payload) =>
    ordersModule.service.handleNotificationSucceeded(payload),
  );
  eventBus.subscribe('NotificationFailed', (payload) =>
    ordersModule.service.handleNotificationFailed(payload),
  );

  const app = new Elysia()
    .use(
      cors({
        origin: localAdminOrigins,
      }),
    )
    .use(
      openapi({
        documentation: {
          info: {
            title: 'ISP 话费充值平台 API',
            version: '1.0.0',
            description: 'ISP 话费充值 V1 的后台、开放、内部接口文档',
          },
          tags: [
            { name: 'open-api', description: '渠道开放接口' },
            { name: 'admin', description: '后台管理接口' },
            { name: 'internal', description: '内部服务接口' },
            { name: 'callbacks', description: '供应商回调接口' },
          ],
        },
        path: '/openapi',
      }),
    )
    .use(createRequestContextPlugin())
    .use(createErrorPlugin())
    .use(createAuthPlugin())
    .get(
      '/health',
      ({ request }) => ({
        code: 0,
        message: 'success',
        data: {
          env: env.appEnv,
          status: 'ok',
        },
        requestId: getRequestIdFromRequest(request),
      }),
      {
        detail: {
          tags: ['internal'],
          summary: '检查服务健康状态',
          description: '用于探活与排查的基础健康检查接口，返回当前服务环境与运行状态。',
        },
      },
    )
    .use(iamModule.routes)
    .use(channelsModule.routes)
    .use(productsModule.routes)
    .use(riskModule.routes)
    .use(workerModule.routes)
    .use(ledgerModule.routes)
    .use(ordersModule.routes)
    .use(suppliersModule.routes)
    .use(notificationsModule.routes);

  await workerModule.service.bootstrapRecurringSchedules();

  if (options.startWorkerScheduler ?? true) {
    workerModule.service.startScheduler();
  }

  return {
    app,
    services: {
      iam: iamModule.service,
      channels: channelsModule.service,
      products: productsModule.service,
      risk: riskModule.service,
      worker: workerModule.service,
      ledger: ledgerModule.service,
      orders: ordersModule.service,
      suppliers: suppliersModule.service,
      notifications: notificationsModule.service,
    },
    stop() {
      workerModule.service.stopScheduler();
    },
  };
}
