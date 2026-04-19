import { writeAuditLog } from '@/lib/audit';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { ChannelContract } from '@/modules/channels/contracts';
import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerContract } from '@/modules/ledger/contracts';
import type { OrderContract } from '@/modules/orders/contracts';
import { OrdersRepository } from '@/modules/orders/orders.repository';
import { createOrdersRoutes } from '@/modules/orders/orders.routes';
import { OrdersService } from '@/modules/orders/orders.service';
import type { ProductContract } from '@/modules/products/contracts';
import type { RiskContract } from '@/modules/risk/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

export interface OrdersModule {
  service: OrdersService;
  contract: OrderContract;
  routes: ReturnType<typeof createOrdersRoutes>;
}

export function createOrdersModule(input: {
  channelContract: ChannelContract;
  productContract: ProductContract;
  riskContract: RiskContract;
  ledgerContract: LedgerContract;
  workerContract: WorkerContract;
  channelsService: ChannelsService;
  iamService: IamService;
}): OrdersModule {
  const repository = new OrdersRepository();
  const service = new OrdersService(
    repository,
    input.channelsService,
    input.channelContract,
    input.productContract,
    input.riskContract,
    input.ledgerContract,
    input.workerContract,
  );

  return {
    service,
    contract: service,
    routes: createOrdersRoutes({
      ordersService: service,
      channelsService: input.channelsService,
      iamService: input.iamService,
      auditLogger: writeAuditLog,
    }),
  };
}
