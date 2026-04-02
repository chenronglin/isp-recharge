import { badRequest, conflict, notFound } from '@/lib/errors';
import { lookupMobileSegment } from '@/lib/mobile-lookup';
import type { ProductContract } from '@/modules/products/contracts';
import type { ProductsRepository } from '@/modules/products/products.repository';
import type {
  RechargeCarrierCode,
  RechargeProductStatus,
  RechargeProductType,
  SaveRechargeProductInput,
} from '@/modules/products/products.types';

const rechargeCarrierCodes = new Set<RechargeCarrierCode>(['CMCC', 'CTCC', 'CUCC', 'CBN']);
const rechargeProductStatuses = new Set<RechargeProductStatus>(['ACTIVE', 'INACTIVE']);

export class ProductsService implements ProductContract {
  constructor(private readonly repository: ProductsRepository) {}

  async listAdminProducts() {
    return this.repository.listAdminProducts();
  }

  async listProducts() {
    return this.repository.listActiveProducts();
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

  async createRechargeProduct(input: SaveRechargeProductInput) {
    const normalizedInput = this.normalizeRechargeProductInput(input);
    await this.ensureRechargeProductUpsertAllowed(normalizedInput);
    return this.repository.createRechargeProduct(normalizedInput);
  }

  async updateRechargeProduct(productId: string, input: SaveRechargeProductInput) {
    const existingProduct = await this.repository.findProductById(productId);

    if (!existingProduct) {
      throw notFound('平台商品不存在');
    }

    const normalizedInput = this.normalizeRechargeProductInput(input);
    await this.ensureRechargeProductUpsertAllowed(normalizedInput, productId);
    return this.repository.updateRechargeProduct(productId, normalizedInput);
  }

  private normalizeRechargeProductInput(input: SaveRechargeProductInput): SaveRechargeProductInput {
    const normalizedProductCode = input.productCode.trim();
    const normalizedProductName = input.productName.trim();
    const normalizedCarrierCode = input.carrierCode.trim().toUpperCase() as RechargeCarrierCode;
    const normalizedProvinceName = input.provinceName.trim();
    const normalizedSalesUnit = input.salesUnit.trim().toUpperCase();
    const normalizedStatus = input.status.trim().toUpperCase() as RechargeProductStatus;

    if (!normalizedProductCode) {
      throw badRequest('productCode 不能为空');
    }

    if (!normalizedProductName) {
      throw badRequest('productName 不能为空');
    }

    if (!normalizedProvinceName) {
      throw badRequest('provinceName 不能为空');
    }

    if (!normalizedSalesUnit) {
      throw badRequest('salesUnit 不能为空');
    }

    if (!Number.isFinite(input.faceValue) || input.faceValue <= 0) {
      throw badRequest('faceValue 必须大于 0');
    }

    if (!rechargeCarrierCodes.has(normalizedCarrierCode)) {
      throw badRequest('carrierCode 不合法');
    }

    if (!rechargeProductStatuses.has(normalizedStatus)) {
      throw badRequest('status 不合法');
    }

    return {
      productCode: normalizedProductCode,
      productName: normalizedProductName,
      carrierCode: normalizedCarrierCode,
      provinceName: normalizedProvinceName,
      faceValue: Number(input.faceValue),
      productType: input.productType,
      salesUnit: normalizedSalesUnit,
      status: normalizedStatus,
    };
  }

  private async ensureRechargeProductUpsertAllowed(
    input: SaveRechargeProductInput,
    currentProductId?: string,
  ) {
    const duplicateCodeProduct = await this.repository.findProductByCode(input.productCode);

    if (duplicateCodeProduct && duplicateCodeProduct.id !== currentProductId) {
      throw conflict('productCode 已存在');
    }

    const duplicateBusinessKeyProduct = await this.repository.findProductByBusinessKey({
      carrierCode: input.carrierCode,
      provinceName: input.provinceName,
      faceValue: input.faceValue,
      productType: input.productType,
    });

    if (duplicateBusinessKeyProduct && duplicateBusinessKeyProduct.id !== currentProductId) {
      throw conflict('运营商、地区、面额与充值模式组合已存在');
    }
  }
}
