import { conflict } from '@/lib/errors';
import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { productsSql } from '@/modules/products/products.sql';
import type {
  ProductSupplierMapping,
  RechargeProduct,
  RechargeProductType,
  SaveRechargeProductInput,
} from '@/modules/products/products.types';

export class ProductsRepository {
  private mapProduct(row: RechargeProduct): RechargeProduct {
    return {
      ...row,
      faceValue: Number(row.faceValue),
    };
  }

  private mapSupplierMapping(row: ProductSupplierMapping): ProductSupplierMapping {
    return {
      ...row,
      costPrice: Number(row.costPrice),
      inventoryQuantity: Number(row.inventoryQuantity),
    };
  }

  async listAdminProducts(): Promise<RechargeProduct[]> {
    const rows = await db.unsafe<RechargeProduct[]>(productsSql.listAdminProducts);
    return rows.map((row) => this.mapProduct(row));
  }

  async listActiveProducts(): Promise<RechargeProduct[]> {
    const rows = await db.unsafe<RechargeProduct[]>(productsSql.listActiveProducts);
    return rows.map((row) => this.mapProduct(row));
  }

  async findMatchingRechargeProduct(input: {
    carrierCode: string;
    province: string;
    faceValue: number;
    productType: RechargeProductType;
  }): Promise<RechargeProduct | null> {
    const provinceMatches = await db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products AS rp
      WHERE rp.carrier_code = ${input.carrierCode}
        AND rp.face_value = ${input.faceValue}
        AND rp.recharge_mode = ${input.productType}
        AND rp.status = 'ACTIVE'
        AND rp.province_name = ${input.province}
        AND EXISTS (
          SELECT 1
          FROM product.product_supplier_mappings AS psm
          WHERE psm.product_id = rp.id
            AND psm.status = 'ACTIVE'
            AND psm.sales_status = 'ON_SALE'
            AND psm.inventory_quantity > 0
            AND psm.dynamic_updated_at >= NOW() - INTERVAL '120 minutes'
        )
      ORDER BY product_code ASC
      LIMIT 2
    `;

    if (provinceMatches.length > 1) {
      throw conflict('命中多个有效充值商品');
    }

    const provinceMatch = provinceMatches[0];

    if (provinceMatch) {
      return this.mapProduct(provinceMatch);
    }

    const nationalMatches = await db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products AS rp
      WHERE rp.carrier_code = ${input.carrierCode}
        AND rp.face_value = ${input.faceValue}
        AND rp.recharge_mode = ${input.productType}
        AND rp.status = 'ACTIVE'
        AND rp.province_name = '全国'
        AND EXISTS (
          SELECT 1
          FROM product.product_supplier_mappings AS psm
          WHERE psm.product_id = rp.id
            AND psm.status = 'ACTIVE'
            AND psm.sales_status = 'ON_SALE'
            AND psm.inventory_quantity > 0
            AND psm.dynamic_updated_at >= NOW() - INTERVAL '120 minutes'
        )
      ORDER BY product_code ASC
      LIMIT 2
    `;

    if (nationalMatches.length > 1) {
      throw conflict('命中多个有效充值商品');
    }

    return nationalMatches[0] ? this.mapProduct(nationalMatches[0]) : null;
  }

  async findProductById(productId: string): Promise<RechargeProduct | null> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE id = ${productId}
      LIMIT 1
    `);

    return row ? this.mapProduct(row) : null;
  }

  async findProductByCode(productCode: string): Promise<RechargeProduct | null> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE product_code = ${productCode}
      LIMIT 1
    `);

    return row ? this.mapProduct(row) : null;
  }

  async findProductByBusinessKey(input: {
    carrierCode: string;
    provinceName: string;
    faceValue: number;
    productType: RechargeProductType;
  }): Promise<RechargeProduct | null> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      SELECT
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
      FROM product.recharge_products
      WHERE carrier_code = ${input.carrierCode}
        AND province_name = ${input.provinceName}
        AND face_value = ${input.faceValue}
        AND recharge_mode = ${input.productType}
      LIMIT 1
    `);

    return row ? this.mapProduct(row) : null;
  }

  async createRechargeProduct(input: SaveRechargeProductInput): Promise<RechargeProduct> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      INSERT INTO product.recharge_products (
        id,
        product_code,
        product_name,
        carrier_code,
        province_name,
        face_value,
        recharge_mode,
        sales_unit,
        status
      )
      VALUES (
        ${generateId()},
        ${input.productCode},
        ${input.productName},
        ${input.carrierCode},
        ${input.provinceName},
        ${input.faceValue},
        ${input.productType},
        ${input.salesUnit},
        ${input.status}
      )
      RETURNING
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
    `);

    if (!row) {
      throw conflict('平台商品创建失败');
    }

    return this.mapProduct(row);
  }

  async updateRechargeProduct(
    productId: string,
    input: SaveRechargeProductInput,
  ): Promise<RechargeProduct> {
    const row = await first<RechargeProduct>(db<RechargeProduct[]>`
      UPDATE product.recharge_products
      SET
        product_code = ${input.productCode},
        product_name = ${input.productName},
        carrier_code = ${input.carrierCode},
        province_name = ${input.provinceName},
        face_value = ${input.faceValue},
        recharge_mode = ${input.productType},
        sales_unit = ${input.salesUnit},
        status = ${input.status},
        updated_at = NOW()
      WHERE id = ${productId}
      RETURNING
        id,
        product_code AS "productCode",
        product_name AS "productName",
        carrier_code AS "carrierCode",
        province_name AS "provinceName",
        face_value AS "faceValue",
        recharge_mode AS "productType",
        sales_unit AS "salesUnit",
        status
    `);

    if (!row) {
      throw conflict('平台商品更新失败');
    }

    return this.mapProduct(row);
  }

  async listMappingsByProductId(productId: string): Promise<ProductSupplierMapping[]> {
    const rows = await db<ProductSupplierMapping[]>`
      SELECT
        id,
        product_id AS "productId",
        supplier_id AS "supplierId",
        supplier_product_code AS "supplierProductCode",
        priority,
        route_type AS "routeType",
        cost_price AS "costPrice",
        sales_status AS "salesStatus",
        inventory_quantity AS "inventoryQuantity",
        dynamic_updated_at AS "dynamicUpdatedAt",
        status
      FROM product.product_supplier_mappings
      WHERE product_id = ${productId}
        AND status = 'ACTIVE'
        AND sales_status = 'ON_SALE'
        AND inventory_quantity > 0
        AND dynamic_updated_at >= NOW() - INTERVAL '120 minutes'
      ORDER BY priority ASC, created_at ASC
    `;

    return rows.map((row) => this.mapSupplierMapping(row));
  }
}
