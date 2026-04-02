export type RechargeProductType = 'FAST' | 'MIXED';

export interface RechargeProduct {
  id: string;
  productCode: string;
  productName: string;
  carrierCode: string;
  provinceName: string;
  faceValue: number;
  productType: RechargeProductType;
  salesUnit: string;
  status: string;
}

export interface ProductSupplierMapping {
  id: string;
  productId: string;
  supplierId: string;
  supplierProductCode: string;
  priority: number;
  routeType: string;
  costPrice: number;
  salesStatus: string;
  inventoryQuantity: number;
  dynamicUpdatedAt: string;
  status: string;
}
