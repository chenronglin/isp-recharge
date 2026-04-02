export const suppliersSql = {
  listSuppliers: `
    SELECT
      id,
      supplier_code AS "supplierCode",
      supplier_name AS "supplierName",
      protocol_type AS "protocolType",
      status
    FROM supplier.suppliers
    ORDER BY created_at DESC
  `,
} as const;
