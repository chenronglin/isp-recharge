export const productsSql = {
  listAdminProducts: `
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
    ORDER BY carrier_code ASC, province_name ASC, face_value ASC, recharge_mode ASC, created_at ASC
  `,
  listActiveProducts: `
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
    ORDER BY carrier_code ASC, province_name ASC, face_value ASC, recharge_mode ASC, created_at ASC
  `,
} as const;
