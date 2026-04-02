import type { IamService } from '@/modules/iam/iam.service';
import type { OrderContract } from '@/modules/orders/contracts';
import { SuppliersRepository } from '@/modules/suppliers/suppliers.repository';
import { createSuppliersRoutes } from '@/modules/suppliers/suppliers.routes';
import { SuppliersService } from '@/modules/suppliers/suppliers.service';
import type { WorkerContract } from '@/modules/worker/contracts';

export interface SuppliersModule {
  service: SuppliersService;
  routes: ReturnType<typeof createSuppliersRoutes>;
}

export function createSuppliersModule(input: {
  iamService: IamService;
  orderContract: OrderContract;
  workerContract: WorkerContract;
}): SuppliersModule {
  const repository = new SuppliersRepository();
  const service = new SuppliersService(repository, input.orderContract, input.workerContract);

  return {
    service,
    routes: createSuppliersRoutes({
      suppliersService: service,
      iamService: input.iamService,
    }),
  };
}
