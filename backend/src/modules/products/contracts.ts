import type {
  ProductSupplierMapping,
  RechargeProduct,
  RechargeProductType,
} from '@/modules/products/products.types';

export interface ProductContract {
  matchRechargeProduct(input: {
    mobile: string;
    faceValue: number;
    productType?: RechargeProductType;
  }): Promise<{
    mobileContext: {
      mobile: string;
      province: string;
      ispName: string;
    };
    product: RechargeProduct;
    supplierCandidates: ProductSupplierMapping[];
  }>;
}
