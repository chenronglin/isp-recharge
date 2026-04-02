import { generateBusinessNo, generateId } from '@/lib/id';
import { encryptText } from '@/lib/security';
import { db, first, many } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { suppliersSql } from '@/modules/suppliers/suppliers.sql';
import type {
  Supplier,
  SupplierCatalogItem,
  SupplierConfig,
  SupplierDynamicItem,
  SupplierOrder,
  SupplierReconcileCandidate,
  SupplierReconcileDiff,
  SupplierSyncLog,
} from '@/modules/suppliers/suppliers.types';

interface ProductRecord {
  id: string;
  productCode: string;
}

interface SupplierMappingRecord {
  productId: string;
  productCode: string;
  status: string;
}

interface ReconcileCandidateRow {
  orderNo: string;
  supplierId: string;
  supplierOrderNo: string;
  platformMainStatus: string;
  platformSupplierStatus: string;
  refundStatus: string;
  supplierOrderStatus: string;
  purchasePrice: string | number;
  orderCreatedAt: string;
  orderUpdatedAt: string;
}

export class SuppliersRepository {
  private mapSupplierConfig(row: SupplierConfig): SupplierConfig {
    return {
      ...row,
      configJson: parseJsonValue(row.configJson, {}),
    };
  }

  private mapSyncLog(row: SupplierSyncLog): SupplierSyncLog {
    return {
      ...row,
      requestPayloadJson: parseJsonValue(row.requestPayloadJson, {}),
      responsePayloadJson: parseJsonValue(row.responsePayloadJson, {}),
    };
  }

  private mapReconcileDiff(row: SupplierReconcileDiff): SupplierReconcileDiff {
    return {
      ...row,
      diffAmount: Number(row.diffAmount),
      detailsJson: parseJsonValue(row.detailsJson, {}),
    };
  }

  private mapSupplierOrder(row: SupplierOrder): SupplierOrder {
    return {
      ...row,
      requestPayloadJson: parseJsonValue(row.requestPayloadJson, {}),
      responsePayloadJson: parseJsonValue(row.responsePayloadJson, {}),
    };
  }

  async listSuppliers(): Promise<Supplier[]> {
    return db.unsafe<Supplier[]>(suppliersSql.listSuppliers);
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
  }): Promise<void> {
    await db`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${JSON.stringify(input.configJson)},
        ${encryptText(input.credential)},
        ${encryptText(input.callbackSecret)},
        ${input.timeoutMs},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_at = NOW()
    `;
  }

  async findSupplierById(supplierId: string): Promise<Supplier | null> {
    return first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        protocol_type AS "protocolType",
        status
      FROM supplier.suppliers
      WHERE id = ${supplierId}
      LIMIT 1
    `);
  }

  async findSupplierByCode(supplierCode: string): Promise<Supplier | null> {
    return first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        protocol_type AS "protocolType",
        status
      FROM supplier.suppliers
      WHERE supplier_code = ${supplierCode}
      LIMIT 1
    `);
  }

  async findConfigBySupplierId(supplierId: string): Promise<SupplierConfig | null> {
    const row = await first<SupplierConfig>(db<SupplierConfig[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        config_json AS "configJson",
        credential_encrypted AS "credentialEncrypted",
        callback_secret_encrypted AS "callbackSecretEncrypted",
        timeout_ms AS "timeoutMs"
      FROM supplier.supplier_configs
      WHERE supplier_id = ${supplierId}
      LIMIT 1
    `);

    return row ? this.mapSupplierConfig(row) : null;
  }

  async findRechargeProductByBusinessKey(item: SupplierCatalogItem): Promise<ProductRecord | null> {
    return first<ProductRecord>(db<ProductRecord[]>`
      SELECT
        id,
        product_code AS "productCode"
      FROM product.recharge_products
      WHERE carrier_code = ${item.carrierCode}
        AND province_name = ${item.provinceName}
        AND face_value = ${item.faceValue}
        AND recharge_mode = ${item.rechargeMode}
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `);
  }

  async updateDynamicCatalogItem(input: {
    supplierId: string;
    item: SupplierDynamicItem;
  }): Promise<ProductRecord | null> {
    const rows = await db<ProductRecord[]>`
      UPDATE product.product_supplier_mappings AS psm
      SET
        cost_price = ${input.item.purchasePrice},
        sales_status = ${input.item.salesStatus},
        inventory_quantity = ${input.item.inventoryQuantity},
        dynamic_updated_at = NOW(),
        updated_at = NOW()
      FROM product.recharge_products AS rp
      WHERE psm.product_id = rp.id
        AND psm.supplier_id = ${input.supplierId}
        AND rp.product_code = ${input.item.productCode}
      RETURNING rp.id, rp.product_code AS "productCode"
    `;

    return rows[0] ?? null;
  }

  async upsertProductSupplierMapping(input: {
    productId: string;
    supplierId: string;
    item: SupplierCatalogItem;
  }): Promise<void> {
    await db`
      INSERT INTO product.product_supplier_mappings (
        id,
        product_id,
        supplier_id,
        supplier_product_code,
        route_type,
        priority,
        cost_price,
        sales_status,
        inventory_quantity,
        dynamic_updated_at,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.productId},
        ${input.supplierId},
        ${input.item.supplierProductCode},
        ${input.item.routeType ?? 'PRIMARY'},
        ${input.item.priority ?? 1},
        ${input.item.purchasePrice},
        ${input.item.salesStatus ?? 'ON_SALE'},
        ${input.item.inventoryQuantity},
        NOW(),
        ${input.item.mappingStatus ?? 'ACTIVE'},
        NOW(),
        NOW()
      )
      ON CONFLICT (product_id, supplier_id) DO UPDATE
      SET
        supplier_product_code = EXCLUDED.supplier_product_code,
        route_type = EXCLUDED.route_type,
        priority = EXCLUDED.priority,
        cost_price = EXCLUDED.cost_price,
        sales_status = EXCLUDED.sales_status,
        inventory_quantity = EXCLUDED.inventory_quantity,
        dynamic_updated_at = EXCLUDED.dynamic_updated_at,
        status = EXCLUDED.status,
        updated_at = NOW()
    `;
  }

  async listMappingsBySupplierId(supplierId: string): Promise<SupplierMappingRecord[]> {
    return db<SupplierMappingRecord[]>`
      SELECT
        psm.product_id AS "productId",
        rp.product_code AS "productCode",
        psm.status
      FROM product.product_supplier_mappings AS psm
      INNER JOIN product.recharge_products AS rp
        ON rp.id = psm.product_id
      WHERE psm.supplier_id = ${supplierId}
      ORDER BY rp.product_code ASC
    `;
  }

  async deactivateProductSupplierMapping(input: {
    productId: string;
    supplierId: string;
  }): Promise<void> {
    await db`
      UPDATE product.product_supplier_mappings
      SET
        sales_status = 'OFF_SALE',
        inventory_quantity = 0,
        dynamic_updated_at = NOW(),
        status = 'INACTIVE',
        updated_at = NOW()
      WHERE product_id = ${input.productId}
        AND supplier_id = ${input.supplierId}
    `;
  }

  async addProductSyncLog(input: {
    supplierId: string;
    syncType: string;
    status: string;
    requestPayloadJson: Record<string, unknown>;
    responsePayloadJson: Record<string, unknown>;
    errorMessage?: string | null;
  }): Promise<SupplierSyncLog> {
    const rows = await db<SupplierSyncLog[]>`
      INSERT INTO product.product_sync_logs (
        id,
        supplier_id,
        sync_type,
        status,
        request_payload_json,
        response_payload_json,
        error_message,
        synced_at,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.syncType},
        ${input.status},
        ${JSON.stringify(input.requestPayloadJson)},
        ${JSON.stringify(input.responsePayloadJson)},
        ${input.errorMessage ?? null},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        supplier_id AS "supplierId",
        sync_type AS "syncType",
        status,
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        error_message AS "errorMessage",
        synced_at AS "syncedAt"
    `;

    const log = rows[0];

    if (!log) {
      throw new Error('记录供应商同步日志失败');
    }

    return this.mapSyncLog(log);
  }

  async listSyncLogsBySupplierId(supplierId: string): Promise<SupplierSyncLog[]> {
    const rows = await db<SupplierSyncLog[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        sync_type AS "syncType",
        status,
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        error_message AS "errorMessage",
        synced_at AS "syncedAt"
      FROM product.product_sync_logs
      WHERE supplier_id = ${supplierId}
      ORDER BY synced_at DESC
      LIMIT 50
    `;

    return rows.map((row) => this.mapSyncLog(row));
  }

  async findSupplierOrderByOrderNo(orderNo: string): Promise<SupplierOrder | null> {
    const row = await first<SupplierOrder>(db<SupplierOrder[]>`
      SELECT
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
      FROM supplier.supplier_orders
      WHERE order_no = ${orderNo}
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return row ? this.mapSupplierOrder(row) : null;
  }

  async findSupplierOrderBySupplierOrderNo(supplierOrderNo: string): Promise<SupplierOrder | null> {
    const row = await first<SupplierOrder>(db<SupplierOrder[]>`
      SELECT
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
      FROM supplier.supplier_orders
      WHERE supplier_order_no = ${supplierOrderNo}
      LIMIT 1
    `);

    return row ? this.mapSupplierOrder(row) : null;
  }

  async createSupplierOrder(input: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo?: string;
    requestPayloadJson: Record<string, unknown>;
    responsePayloadJson: Record<string, unknown>;
    standardStatus: string;
  }): Promise<SupplierOrder> {
    const rows = await db<SupplierOrder[]>`
      INSERT INTO supplier.supplier_orders (
        id,
        order_no,
        supplier_id,
        supplier_order_no,
        request_payload_json,
        response_payload_json,
        standard_status,
        attempt_no,
        duration_ms,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.orderNo},
        ${input.supplierId},
        ${input.supplierOrderNo ?? generateBusinessNo('suporder')},
        ${JSON.stringify(input.requestPayloadJson)},
        ${JSON.stringify(input.responsePayloadJson)},
        ${input.standardStatus},
        1,
        100,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        order_no AS "orderNo",
        supplier_id AS "supplierId",
        supplier_order_no AS "supplierOrderNo",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        standard_status AS "standardStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs"
    `;

    const supplierOrder = rows[0];

    if (!supplierOrder) {
      throw new Error('创建供应商订单失败');
    }

    return this.mapSupplierOrder(supplierOrder);
  }

  async updateSupplierOrderStatus(
    supplierOrderNo: string,
    status: string,
    responsePayloadJson: Record<string, unknown>,
  ) {
    await db`
      UPDATE supplier.supplier_orders
      SET
        standard_status = ${status},
        response_payload_json = ${JSON.stringify(responsePayloadJson)},
        updated_at = NOW()
      WHERE supplier_order_no = ${supplierOrderNo}
    `;
  }

  async addCallbackLog(input: {
    supplierId: string | null;
    supplierCode: string;
    supplierOrderNo: string | null;
    headersJson: Record<string, unknown>;
    bodyJson: Record<string, unknown>;
    signatureValid: boolean;
    parsedStatus: string | null;
    idempotencyKey: string;
  }): Promise<void> {
    await db`
      INSERT INTO supplier.supplier_callback_logs (
        id,
        supplier_id,
        supplier_code,
        supplier_order_no,
        headers_json,
        body_json,
        signature_valid,
        parsed_status,
        idempotency_key,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.supplierCode},
        ${input.supplierOrderNo},
        ${JSON.stringify(input.headersJson)},
        ${JSON.stringify(input.bodyJson)},
        ${input.signatureValid},
        ${input.parsedStatus},
        ${input.idempotencyKey},
        NOW()
      )
    `;
  }

  async listReconcileCandidates(input: {
    reconcileDate: string;
    onlyInflight: boolean;
  }): Promise<SupplierReconcileCandidate[]> {
    const rows = await many<ReconcileCandidateRow>(db<ReconcileCandidateRow[]>`
      SELECT
        o.order_no AS "orderNo",
        so.supplier_id AS "supplierId",
        so.supplier_order_no AS "supplierOrderNo",
        o.main_status AS "platformMainStatus",
        o.supplier_status AS "platformSupplierStatus",
        o.refund_status AS "refundStatus",
        so.standard_status AS "supplierOrderStatus",
        o.cost_price AS "purchasePrice",
        o.created_at AS "orderCreatedAt",
        o.updated_at AS "orderUpdatedAt"
      FROM ordering.orders AS o
      INNER JOIN supplier.supplier_orders AS so
        ON so.order_no = o.order_no
      WHERE (
        ${input.onlyInflight}
        AND (
          o.main_status IN ('CREATED', 'PROCESSING', 'REFUNDING')
          OR o.refund_status = 'PENDING'
        )
      ) OR (
        NOT ${input.onlyInflight}
        AND o.created_at::date = ${input.reconcileDate}::date
      )
      ORDER BY o.created_at ASC, o.order_no ASC
    `);

    return rows.map((row) => ({
      ...row,
      purchasePrice: Number(row.purchasePrice),
    }));
  }

  async findReconcileDiff(input: {
    supplierId: string;
    reconcileDate: string;
    orderNo: string | null;
    diffType: string;
  }): Promise<SupplierReconcileDiff | null> {
    const row = await first<SupplierReconcileDiff>(db<SupplierReconcileDiff[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        reconcile_date::text AS "reconcileDate",
        order_no AS "orderNo",
        diff_type AS "diffType",
        diff_amount AS "diffAmount",
        details_json AS "detailsJson",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.supplier_reconcile_diffs
      WHERE supplier_id = ${input.supplierId}
        AND reconcile_date = ${input.reconcileDate}::date
        AND order_no IS NOT DISTINCT FROM ${input.orderNo}
        AND diff_type = ${input.diffType}
      ORDER BY created_at DESC
      LIMIT 1
    `);

    return row ? this.mapReconcileDiff(row) : null;
  }

  async upsertReconcileDiff(input: {
    supplierId: string;
    reconcileDate: string;
    orderNo: string | null;
    diffType: string;
    diffAmount: number;
    detailsJson: Record<string, unknown>;
    status?: string;
  }): Promise<SupplierReconcileDiff> {
    const rows = await db<SupplierReconcileDiff[]>`
      INSERT INTO supplier.supplier_reconcile_diffs (
        id,
        supplier_id,
        reconcile_date,
        order_no,
        diff_type,
        diff_amount,
        details_json,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.reconcileDate}::date,
        ${input.orderNo},
        ${input.diffType},
        ${input.diffAmount},
        ${JSON.stringify(input.detailsJson)},
        ${input.status ?? 'OPEN'},
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING
        id,
        supplier_id AS "supplierId",
        reconcile_date::text AS "reconcileDate",
        order_no AS "orderNo",
        diff_type AS "diffType",
        diff_amount AS "diffAmount",
        details_json AS "detailsJson",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const diff = rows[0];

    if (diff) {
      return this.mapReconcileDiff(diff);
    }

    const existing = await this.findReconcileDiff({
      supplierId: input.supplierId,
      reconcileDate: input.reconcileDate,
      orderNo: input.orderNo,
      diffType: input.diffType,
    });

    if (!existing) {
      throw new Error('创建供应商对账差异失败');
    }

    return existing;
  }

  async listReconcileDiffs(input?: {
    reconcileDate?: string;
    orderNo?: string;
  }): Promise<SupplierReconcileDiff[]> {
    const rows = await many<SupplierReconcileDiff>(db<SupplierReconcileDiff[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        reconcile_date::text AS "reconcileDate",
        order_no AS "orderNo",
        diff_type AS "diffType",
        diff_amount AS "diffAmount",
        details_json AS "detailsJson",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.supplier_reconcile_diffs
      WHERE (${input?.reconcileDate ?? null}::date IS NULL OR reconcile_date = ${input?.reconcileDate ?? null}::date)
        AND (${input?.orderNo ?? null} IS NULL OR order_no = ${input?.orderNo ?? null})
      ORDER BY created_at ASC, id ASC
    `);

    return rows.map((row) => this.mapReconcileDiff(row));
  }
}
