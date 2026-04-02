import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import type { ProductContract } from '@/modules/products/contracts';
import { ProductsRepository } from '@/modules/products/products.repository';
import { createProductsRoutes } from '@/modules/products/products.routes';
import { ProductsService } from '@/modules/products/products.service';

export interface ProductsModule {
  service: ProductsService;
  contract: ProductContract;
  routes: ReturnType<typeof createProductsRoutes>;
}

export function createProductsModule(
  iamService: IamService,
  channelsService: ChannelsService,
): ProductsModule {
  const repository = new ProductsRepository();
  const service = new ProductsService(repository);

  return {
    service,
    contract: service,
    routes: createProductsRoutes({
      productsService: service,
      iamService,
      channelsService,
    }),
  };
}
