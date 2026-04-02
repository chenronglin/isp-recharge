import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerContract } from '@/modules/ledger/contracts';
import { LedgerRepository } from '@/modules/ledger/ledger.repository';
import { createLedgerRoutes } from '@/modules/ledger/ledger.routes';
import { LedgerService } from '@/modules/ledger/ledger.service';

export interface LedgerModule {
  service: LedgerService;
  contract: LedgerContract;
  routes: ReturnType<typeof createLedgerRoutes>;
}

export function createLedgerModule(
  iamService: IamService,
  channelsService: ChannelsService,
): LedgerModule {
  const repository = new LedgerRepository();
  const service = new LedgerService(repository);

  return {
    service,
    contract: service,
    routes: createLedgerRoutes({
      ledgerService: service,
      iamService,
      channelsService,
    }),
  };
}
