import type { IamContract } from '@/modules/iam/contracts';
import { IamRepository } from '@/modules/iam/iam.repository';
import { createIamRoutes } from '@/modules/iam/iam.routes';
import { IamService } from '@/modules/iam/iam.service';

export interface IamModule {
  service: IamService;
  contract: IamContract;
  routes: ReturnType<typeof createIamRoutes>;
}

export function createIamModule(): IamModule {
  const repository = new IamRepository();
  const service = new IamService(repository);

  return {
    service,
    contract: service,
    routes: createIamRoutes({
      iamService: service,
    }),
  };
}
