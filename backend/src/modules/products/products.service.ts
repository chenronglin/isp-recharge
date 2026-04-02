import { badRequest, notFound } from '@/lib/errors';
import { lookupMobileSegment } from '@/lib/mobile-lookup';
import type { ProductContract } from '@/modules/products/contracts';
import type { ProductsRepository } from '@/modules/products/products.repository';
import type { RechargeProductType } from '@/modules/products/products.types';

export class ProductsService implements ProductContract {
  constructor(private readonly repository: ProductsRepository) {}

  async listProducts() {
    return this.repository.listProducts();
  }

  async matchRechargeProduct(input: {
    mobile: string;
    faceValue: number;
    productType?: RechargeProductType;
  }) {
    if (!Number.isFinite(input.faceValue) || input.faceValue <= 0) {
      throw badRequest('faceValue 必须大于 0');
    }

    const mobileContext = await lookupMobileSegment(input.mobile);
    const product = await this.repository.findMatchingRechargeProduct({
      carrierCode: mobileContext.ispName,
      province: mobileContext.province,
      faceValue: input.faceValue,
      productType: input.productType ?? 'MIXED',
    });

    if (!product) {
      throw notFound('未匹配到可用充值商品');
    }

    const supplierCandidates = await this.repository.listMappingsByProductId(product.id);

    if (supplierCandidates.length === 0) {
      throw badRequest('商品暂无可用供应商映射');
    }

    return {
      mobileContext,
      product,
      supplierCandidates,
    };
  }
}
