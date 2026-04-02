import type { IamService } from '@/modules/iam/iam.service';
import type { WorkerContract } from '@/modules/worker/contracts';
import { WorkerRepository } from '@/modules/worker/worker.repository';
import { createWorkerRoutes } from '@/modules/worker/worker.routes';
import { WorkerService } from '@/modules/worker/worker.service';

export interface WorkerModule {
  service: WorkerService;
  contract: WorkerContract;
  routes: ReturnType<typeof createWorkerRoutes>;
}

export function createWorkerModule(iamService: IamService): WorkerModule {
  const repository = new WorkerRepository();
  const service = new WorkerService(repository);

  return {
    service,
    contract: service,
    routes: createWorkerRoutes({
      workerService: service,
      iamService,
    }),
  };
}
