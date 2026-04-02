import type { IamService } from '@/modules/iam/iam.service';
import type { RiskContract } from '@/modules/risk/contracts';
import { RiskRepository } from '@/modules/risk/risk.repository';
import { createRiskRoutes } from '@/modules/risk/risk.routes';
import { RiskService } from '@/modules/risk/risk.service';

export interface RiskModule {
  service: RiskService;
  contract: RiskContract;
  routes: ReturnType<typeof createRiskRoutes>;
}

export function createRiskModule(iamService: IamService): RiskModule {
  const repository = new RiskRepository();
  const service = new RiskService(repository);

  return {
    service,
    contract: service,
    routes: createRiskRoutes({
      riskService: service,
      iamService,
    }),
  };
}
