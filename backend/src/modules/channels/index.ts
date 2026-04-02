import { ChannelsRepository } from '@/modules/channels/channels.repository';
import { createChannelsRoutes } from '@/modules/channels/channels.routes';
import { ChannelsService } from '@/modules/channels/channels.service';
import type { ChannelContract } from '@/modules/channels/contracts';
import type { IamService } from '@/modules/iam/iam.service';

export interface ChannelsModule {
  service: ChannelsService;
  contract: ChannelContract;
  routes: ReturnType<typeof createChannelsRoutes>;
}

export function createChannelsModule(iamService: IamService): ChannelsModule {
  const repository = new ChannelsRepository();
  const service = new ChannelsService(repository);

  return {
    service,
    contract: service,
    routes: createChannelsRoutes({
      channelsService: service,
      iamService,
    }),
  };
}
