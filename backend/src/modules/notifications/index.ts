import type { IamService } from '@/modules/iam/iam.service';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import { createNotificationsRoutes } from '@/modules/notifications/notifications.routes';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import type { OrderContract } from '@/modules/orders/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

export interface NotificationsModule {
  service: NotificationsService;
  routes: ReturnType<typeof createNotificationsRoutes>;
}

export function createNotificationsModule(input: {
  iamService: IamService;
  orderContract: OrderContract;
  workerContract: WorkerContract;
}): NotificationsModule {
  const repository = new NotificationsRepository();
  const service = new NotificationsService(repository, input.orderContract, input.workerContract);

  return {
    service,
    routes: createNotificationsRoutes({
      notificationsService: service,
      iamService: input.iamService,
    }),
  };
}
