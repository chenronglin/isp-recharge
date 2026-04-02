export type RechargeProductType = 'FAST' | 'MIXED';
export type RechargeCarrierCode = 'CMCC' | 'CTCC' | 'CUCC' | 'CBN';
export type RechargeProductStatus = 'ACTIVE' | 'INACTIVE';

export interface RechargeProduct {
  id: string;
  productCode: string;
  productName: string;
  carrierCode: RechargeCarrierCode;
  provinceName: string;
  faceValue: number;
  productType: RechargeProductType;
  salesUnit: string;
  status: RechargeProductStatus;
}

export interface SaveRechargeProductInput {
  productCode: string;
  productName: string;
  carrierCode: RechargeCarrierCode;
  provinceName: string;
  faceValue: number;
  productType: RechargeProductType;
  salesUnit: string;
  status: RechargeProductStatus;
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
