export const productsSql = {
  listProducts: `
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
    WHERE status = 'ACTIVE'
    ORDER BY face_value ASC, created_at DESC
  `,
} as const;
