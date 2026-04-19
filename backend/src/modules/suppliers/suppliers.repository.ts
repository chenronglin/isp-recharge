import { generateBusinessNo, generateId } from '@/lib/id';
import { encryptText } from '@/lib/security';
import { db, first, many } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import type {
  Supplier,
  SupplierBalanceSnapshot,
  SupplierCatalogItem,
  SupplierConfig,
  SupplierConsumptionLog,
  SupplierDynamicItem,
  SupplierHealthCheck,
  SupplierOrder,
  SupplierRechargeRecord,
  SupplierReconcileCandidate,
  SupplierReconcileDiff,
  SupplierRequestLog,
  SupplierRuntimeBreaker,
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

interface SupplierHealthMetrics {
  supplierId: string;
  totalCount: number;
  successCount: number;
  timeoutCount: number;
  protocolFailCount: number;
  averageDurationMs: number;
}

export class SuppliersRepository {
  private mapSupplier(row: Supplier): Supplier {
    return {
      ...row,
      supportsBalanceQuery: Boolean(row.supportsBalanceQuery),
      supportsRechargeRecords: Boolean(row.supportsRechargeRecords),
      supportsConsumptionLog: Boolean(row.supportsConsumptionLog),
    };
  }

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

  private mapRequestLog(row: SupplierRequestLog): SupplierRequestLog {
    return {
      ...row,
      requestPayloadJson: parseJsonValue(row.requestPayloadJson, {}),
      responsePayloadJson: parseJsonValue(row.responsePayloadJson, {}),
    };
  }

  private mapRuntimeBreaker(row: SupplierRuntimeBreaker): SupplierRuntimeBreaker {
    return {
      ...row,
      failCountWindow: Number(row.failCountWindow),
      failThreshold: Number(row.failThreshold),
      recoveryTimeoutSeconds: Number(row.recoveryTimeoutSeconds),
    };
  }

  private mapBalanceSnapshot(
    row: SupplierBalanceSnapshot & { balanceAmount: number | string },
  ): SupplierBalanceSnapshot {
    return {
      ...row,
      balanceAmount: Number(row.balanceAmount),
      rawPayloadJson: parseJsonValue(row.rawPayloadJson, {}),
    };
  }

  private mapHealthCheck(row: SupplierHealthCheck): SupplierHealthCheck {
    return row;
  }

  private mapConsumptionLog(
    row: SupplierConsumptionLog & { amount: number | string },
  ): SupplierConsumptionLog {
    return {
      ...row,
      amount: Number(row.amount),
      rawPayloadJson: parseJsonValue(row.rawPayloadJson, {}),
    };
  }

  private mapRechargeRecord(
    row: SupplierRechargeRecord & {
      amount: number | string;
      beforeBalance: number | string;
      afterBalance: number | string;
    },
  ): SupplierRechargeRecord {
    return {
      ...row,
      amount: Number(row.amount),
      beforeBalance: Number(row.beforeBalance),
      afterBalance: Number(row.afterBalance),
      rawPayloadJson: parseJsonValue(row.rawPayloadJson, {}),
    };
  }

  async listSuppliers(input?: {
    pageNum?: number;
    pageSize?: number;
    keyword?: string;
    cooperationStatus?: string;
    healthStatus?: string;
    protocolType?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: Supplier[]; total: number }> {
    if (!input) {
      const rows = await db.unsafe<Supplier[]>(`
        SELECT
          id,
          supplier_code AS "supplierCode",
          supplier_name AS "supplierName",
          contact_name AS "contactName",
          contact_phone AS "contactPhone",
          contact_email AS "contactEmail",
          base_url AS "baseUrl",
          protocol_type AS "protocolType",
          credential_mode AS "credentialMode",
          access_account AS "accessAccount",
          access_password_encrypted AS "accessPasswordEncrypted",
          cooperation_status AS "cooperationStatus",
          supports_balance_query AS "supportsBalanceQuery",
          supports_recharge_records AS "supportsRechargeRecords",
          supports_consumption_log AS "supportsConsumptionLog",
          remark,
          health_status AS "healthStatus",
          last_health_check_at AS "lastHealthCheckAt",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM supplier.suppliers
        ORDER BY created_at DESC
      `);
      return {
        items: rows.map((row) => this.mapSupplier(row)),
        total: rows.length,
      };
    }

    const pageNum = input.pageNum ?? 1;
    const pageSize = input.pageSize ?? 20;
    const offset = (pageNum - 1) * pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      supplierCode: 'supplier_code',
      supplierName: 'supplier_name',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (input.keyword?.trim()) {
      params.push(`%${input.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(
        `(supplier_code ILIKE $${index} OR supplier_name ILIKE $${index} OR COALESCE(access_account, '') ILIKE $${index})`,
      );
    }

    const equalityConditions: Array<[string, string | undefined]> = [
      ['cooperation_status', input.cooperationStatus],
      ['health_status', input.healthStatus],
      ['protocol_type', input.protocolType],
    ];

    for (const [column, value] of equalityConditions) {
      if (!value?.trim()) {
        continue;
      }

      params.push(value.trim());
      whereClauses.push(`${column} = $${params.length}`);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const rows = await db.unsafe<Supplier[]>(
      `
        SELECT
          id,
          supplier_code AS "supplierCode",
          supplier_name AS "supplierName",
          contact_name AS "contactName",
          contact_phone AS "contactPhone",
          contact_email AS "contactEmail",
          base_url AS "baseUrl",
          protocol_type AS "protocolType",
          credential_mode AS "credentialMode",
          access_account AS "accessAccount",
          access_password_encrypted AS "accessPasswordEncrypted",
          cooperation_status AS "cooperationStatus",
          supports_balance_query AS "supportsBalanceQuery",
          supports_recharge_records AS "supportsRechargeRecords",
          supports_consumption_log AS "supportsConsumptionLog",
          remark,
          health_status AS "healthStatus",
          last_health_check_at AS "lastHealthCheckAt",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM supplier.suppliers
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM supplier.suppliers
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => this.mapSupplier(row)),
      total: total?.total ?? 0,
    };
  }

  async createSupplier(input: {
    supplierCode: string;
    supplierName: string;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    baseUrl?: string | null;
    protocolType: string;
    credentialMode: string;
    accessAccount?: string | null;
    accessPasswordEncrypted?: string | null;
    cooperationStatus: string;
    supportsBalanceQuery: boolean;
    supportsRechargeRecords: boolean;
    supportsConsumptionLog: boolean;
    remark?: string | null;
    healthStatus: string;
    status: string;
  }): Promise<Supplier> {
    const rows = await db<Supplier[]>`
      INSERT INTO supplier.suppliers (
        id,
        supplier_code,
        supplier_name,
        contact_name,
        contact_phone,
        contact_email,
        base_url,
        protocol_type,
        credential_mode,
        access_account,
        access_password_encrypted,
        cooperation_status,
        supports_balance_query,
        supports_recharge_records,
        supports_consumption_log,
        remark,
        health_status,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierCode},
        ${input.supplierName},
        ${input.contactName ?? null},
        ${input.contactPhone ?? null},
        ${input.contactEmail ?? null},
        ${input.baseUrl ?? null},
        ${input.protocolType},
        ${input.credentialMode},
        ${input.accessAccount ?? null},
        ${input.accessPasswordEncrypted ?? null},
        ${input.cooperationStatus},
        ${input.supportsBalanceQuery},
        ${input.supportsRechargeRecords},
        ${input.supportsConsumptionLog},
        ${input.remark ?? null},
        ${input.healthStatus},
        ${input.status},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        credential_mode AS "credentialMode",
        access_account AS "accessAccount",
        access_password_encrypted AS "accessPasswordEncrypted",
        cooperation_status AS "cooperationStatus",
        supports_balance_query AS "supportsBalanceQuery",
        supports_recharge_records AS "supportsRechargeRecords",
        supports_consumption_log AS "supportsConsumptionLog",
        remark,
        health_status AS "healthStatus",
        last_health_check_at AS "lastHealthCheckAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    return this.mapSupplier(rows[0] as Supplier);
  }

  async updateSupplier(
    supplierId: string,
    input: {
      supplierName: string;
      contactName?: string | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
      baseUrl?: string | null;
      protocolType: string;
      credentialMode: string;
      accessAccount?: string | null;
      accessPasswordEncrypted?: string | null;
      cooperationStatus: string;
      supportsBalanceQuery: boolean;
      supportsRechargeRecords: boolean;
      supportsConsumptionLog: boolean;
      remark?: string | null;
      healthStatus: string;
      status: string;
    },
  ): Promise<Supplier | null> {
    const rows = await db<Supplier[]>`
      UPDATE supplier.suppliers
      SET
        supplier_name = ${input.supplierName},
        contact_name = ${input.contactName ?? null},
        contact_phone = ${input.contactPhone ?? null},
        contact_email = ${input.contactEmail ?? null},
        base_url = ${input.baseUrl ?? null},
        protocol_type = ${input.protocolType},
        credential_mode = ${input.credentialMode},
        access_account = ${input.accessAccount ?? null},
        access_password_encrypted = COALESCE(${input.accessPasswordEncrypted ?? null}, access_password_encrypted),
        cooperation_status = ${input.cooperationStatus},
        supports_balance_query = ${input.supportsBalanceQuery},
        supports_recharge_records = ${input.supportsRechargeRecords},
        supports_consumption_log = ${input.supportsConsumptionLog},
        remark = ${input.remark ?? null},
        health_status = ${input.healthStatus},
        status = ${input.status},
        updated_at = NOW()
      WHERE id = ${supplierId}
      RETURNING
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        credential_mode AS "credentialMode",
        access_account AS "accessAccount",
        access_password_encrypted AS "accessPasswordEncrypted",
        cooperation_status AS "cooperationStatus",
        supports_balance_query AS "supportsBalanceQuery",
        supports_recharge_records AS "supportsRechargeRecords",
        supports_consumption_log AS "supportsConsumptionLog",
        remark,
        health_status AS "healthStatus",
        last_health_check_at AS "lastHealthCheckAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    return rows[0] ? this.mapSupplier(rows[0] as Supplier) : null;
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
    updatedBy?: string | null;
  }): Promise<void> {
    await db`
      INSERT INTO supplier.supplier_configs (
        id,
        supplier_id,
        config_json,
        credential_encrypted,
        callback_secret_encrypted,
        timeout_ms,
        updated_by,
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
        ${input.updatedBy ?? null},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        config_json = EXCLUDED.config_json,
        credential_encrypted = EXCLUDED.credential_encrypted,
        callback_secret_encrypted = EXCLUDED.callback_secret_encrypted,
        timeout_ms = EXCLUDED.timeout_ms,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `;
  }

  async findSupplierById(supplierId: string): Promise<Supplier | null> {
    const row = await first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        credential_mode AS "credentialMode",
        access_account AS "accessAccount",
        access_password_encrypted AS "accessPasswordEncrypted",
        cooperation_status AS "cooperationStatus",
        supports_balance_query AS "supportsBalanceQuery",
        supports_recharge_records AS "supportsRechargeRecords",
        supports_consumption_log AS "supportsConsumptionLog",
        remark,
        health_status AS "healthStatus",
        last_health_check_at AS "lastHealthCheckAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.suppliers
      WHERE id = ${supplierId}
      LIMIT 1
    `);

    return row ? this.mapSupplier(row) : null;
  }

  async findSupplierByCode(supplierCode: string): Promise<Supplier | null> {
    const row = await first<Supplier>(db<Supplier[]>`
      SELECT
        id,
        supplier_code AS "supplierCode",
        supplier_name AS "supplierName",
        contact_name AS "contactName",
        contact_phone AS "contactPhone",
        contact_email AS "contactEmail",
        base_url AS "baseUrl",
        protocol_type AS "protocolType",
        credential_mode AS "credentialMode",
        access_account AS "accessAccount",
        access_password_encrypted AS "accessPasswordEncrypted",
        cooperation_status AS "cooperationStatus",
        supports_balance_query AS "supportsBalanceQuery",
        supports_recharge_records AS "supportsRechargeRecords",
        supports_consumption_log AS "supportsConsumptionLog",
        remark,
        health_status AS "healthStatus",
        last_health_check_at AS "lastHealthCheckAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.suppliers
      WHERE supplier_code = ${supplierCode}
      LIMIT 1
    `);

    return row ? this.mapSupplier(row) : null;
  }

  async findConfigBySupplierId(supplierId: string): Promise<SupplierConfig | null> {
    const row = await first<SupplierConfig>(db<SupplierConfig[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        config_json AS "configJson",
        credential_encrypted AS "credentialEncrypted",
        callback_secret_encrypted AS "callbackSecretEncrypted",
        timeout_ms AS "timeoutMs",
        updated_by AS "updatedBy",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
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

  async findLatestBalanceSnapshot(supplierId: string): Promise<SupplierBalanceSnapshot | null> {
    const row = await first<
      SupplierBalanceSnapshot & { balanceAmount: number | string }
    >(db<
      (SupplierBalanceSnapshot & { balanceAmount: number | string })[]
    >`
      SELECT
        id,
        supplier_id AS "supplierId",
        balance_amount AS "balanceAmount",
        currency,
        balance_status AS "balanceStatus",
        source_type AS "sourceType",
        queried_at AS "queriedAt",
        raw_payload_json AS "rawPayloadJson"
      FROM supplier.supplier_balance_snapshots
      WHERE supplier_id = ${supplierId}
      ORDER BY queried_at DESC, id DESC
      LIMIT 1
    `);

    return row ? this.mapBalanceSnapshot(row) : null;
  }

  async addBalanceSnapshot(input: {
    supplierId: string;
    balanceAmount: number;
    currency: string;
    balanceStatus: string;
    sourceType: string;
    rawPayloadJson: Record<string, unknown>;
  }): Promise<SupplierBalanceSnapshot> {
    const rows = await db<
      (SupplierBalanceSnapshot & { balanceAmount: number | string })[]
    >`
      INSERT INTO supplier.supplier_balance_snapshots (
        id,
        supplier_id,
        balance_amount,
        currency,
        balance_status,
        source_type,
        queried_at,
        raw_payload_json,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.balanceAmount},
        ${input.currency},
        ${input.balanceStatus},
        ${input.sourceType},
        NOW(),
        ${JSON.stringify(input.rawPayloadJson)},
        NOW()
      )
      RETURNING
        id,
        supplier_id AS "supplierId",
        balance_amount AS "balanceAmount",
        currency,
        balance_status AS "balanceStatus",
        source_type AS "sourceType",
        queried_at AS "queriedAt",
        raw_payload_json AS "rawPayloadJson"
    `;

    return this.mapBalanceSnapshot(rows[0] as SupplierBalanceSnapshot & { balanceAmount: number | string });
  }

  async findLatestHealthCheck(supplierId: string): Promise<SupplierHealthCheck | null> {
    const row = await first<SupplierHealthCheck>(db<SupplierHealthCheck[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        health_status AS "healthStatus",
        http_status AS "httpStatus",
        message,
        last_success_at AS "lastSuccessAt",
        last_failure_at AS "lastFailureAt",
        checked_at AS "checkedAt"
      FROM supplier.supplier_health_checks
      WHERE supplier_id = ${supplierId}
      ORDER BY checked_at DESC, id DESC
      LIMIT 1
    `);

    return row ? this.mapHealthCheck(row) : null;
  }

  async addHealthCheck(input: {
    supplierId: string;
    healthStatus: string;
    httpStatus?: number | null;
    message?: string | null;
    lastSuccessAt?: Date | null;
    lastFailureAt?: Date | null;
  }): Promise<SupplierHealthCheck> {
    const rows = await db<SupplierHealthCheck[]>`
      INSERT INTO supplier.supplier_health_checks (
        id,
        supplier_id,
        health_status,
        http_status,
        message,
        last_success_at,
        last_failure_at,
        checked_at,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.healthStatus},
        ${input.httpStatus ?? null},
        ${input.message ?? null},
        ${input.lastSuccessAt ?? null},
        ${input.lastFailureAt ?? null},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        supplier_id AS "supplierId",
        health_status AS "healthStatus",
        http_status AS "httpStatus",
        message,
        last_success_at AS "lastSuccessAt",
        last_failure_at AS "lastFailureAt",
        checked_at AS "checkedAt"
    `;

    await db`
      UPDATE supplier.suppliers
      SET
        health_status = ${input.healthStatus},
        last_health_check_at = NOW(),
        updated_at = NOW()
      WHERE id = ${input.supplierId}
    `;

    return rows[0] as SupplierHealthCheck;
  }

  async listConsumptionLogs(input: {
    supplierId: string;
    startTime?: string | null;
    endTime?: string | null;
    mobile?: string;
    orderNo?: string;
    supplierOrderNo?: string;
  }): Promise<SupplierConsumptionLog[]> {
    const params: unknown[] = [input.supplierId];
    const whereClauses = ['supplier_id = $1'];

    if (input.startTime) {
      params.push(input.startTime);
      whereClauses.push(`occurred_at >= $${params.length}::timestamptz`);
    }

    if (input.endTime) {
      params.push(input.endTime);
      whereClauses.push(`occurred_at <= $${params.length}::timestamptz`);
    }

    const equalityConditions: Array<[string, string | undefined]> = [
      ['mobile', input.mobile],
      ['order_no', input.orderNo],
      ['supplier_order_no', input.supplierOrderNo],
    ];

    for (const [column, value] of equalityConditions) {
      if (!value?.trim()) {
        continue;
      }

      params.push(value.trim());
      whereClauses.push(`${column} = $${params.length}`);
    }

    const rows = await db.unsafe<
      (SupplierConsumptionLog & { amount: number | string })[]
    >(
      `
        SELECT
          id,
          supplier_id AS "supplierId",
          mobile,
          order_no AS "orderNo",
          supplier_order_no AS "supplierOrderNo",
          amount,
          status,
          occurred_at AS "occurredAt",
          raw_payload_json AS "rawPayloadJson"
        FROM supplier.supplier_consumption_logs
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
      `,
      params,
    );

    return rows.map((row) => this.mapConsumptionLog(row));
  }

  async listSupplierProducts(input: {
    supplierId: string;
    carrierCode?: string;
    province?: string;
    faceValue?: number;
    status?: string;
    updatedStartTime?: string | null;
    updatedEndTime?: string | null;
  }) {
    const params: unknown[] = [input.supplierId];
    const whereClauses = ['mapping.supplier_id = $1'];

    if (input.carrierCode) {
      params.push(input.carrierCode);
      whereClauses.push(`product.carrier_code = $${params.length}`);
    }

    if (input.province) {
      params.push(input.province);
      whereClauses.push(`product.province_name = $${params.length}`);
    }

    if (input.faceValue !== undefined) {
      params.push(input.faceValue);
      whereClauses.push(`product.face_value = $${params.length}`);
    }

    if (input.status) {
      params.push(input.status);
      whereClauses.push(`mapping.status = $${params.length}`);
    }

    if (input.updatedStartTime) {
      params.push(input.updatedStartTime);
      whereClauses.push(`mapping.updated_at >= $${params.length}::timestamptz`);
    }

    if (input.updatedEndTime) {
      params.push(input.updatedEndTime);
      whereClauses.push(`mapping.updated_at <= $${params.length}::timestamptz`);
    }

    return db.unsafe<
      Array<{
        snapshotId: string;
        supplierId: string;
        supplierCode: string;
        supplierProductCode: string;
        productName: string;
        carrierCode: string;
        province: string;
        faceValue: number | string;
        costPrice: number | string;
        saleStatus: string;
        stockStatus: string;
        arrivalSla: string;
        rechargeRange: unknown;
        updatedAt: string;
        rawPayload: Record<string, unknown>;
      }>
    >(
      `
        SELECT
          mapping.id AS "snapshotId",
          mapping.supplier_id AS "supplierId",
          supplier.supplier_code AS "supplierCode",
          mapping.supplier_product_code AS "supplierProductCode",
          product.product_name AS "productName",
          product.carrier_code AS "carrierCode",
          product.province_name AS province,
          product.face_value AS "faceValue",
          mapping.cost_price AS "costPrice",
          mapping.sales_status AS "saleStatus",
          CASE WHEN mapping.inventory_quantity > 0 THEN 'IN_STOCK' ELSE 'OUT_OF_STOCK' END AS "stockStatus",
          product.arrival_sla AS "arrivalSla",
          product.recharge_range_json AS "rechargeRange",
          mapping.updated_at AS "updatedAt",
          jsonb_build_object(
            'mappingStatus', mapping.status,
            'inventoryQuantity', mapping.inventory_quantity,
            'routeType', mapping.route_type
          ) AS "rawPayload"
        FROM product.product_supplier_mappings AS mapping
        INNER JOIN product.recharge_products AS product
          ON product.id = mapping.product_id
        INNER JOIN supplier.suppliers AS supplier
          ON supplier.id = mapping.supplier_id
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY mapping.updated_at DESC, mapping.id DESC
      `,
      params,
    );
  }

  async listRechargeRecords(supplierId: string): Promise<SupplierRechargeRecord[]> {
    const rows = await db<
      (SupplierRechargeRecord & {
        amount: number | string;
        beforeBalance: number | string;
        afterBalance: number | string;
      })[]
    >`
      SELECT
        id,
        supplier_id AS "supplierId",
        recharge_type AS "rechargeType",
        amount,
        currency,
        before_balance AS "beforeBalance",
        after_balance AS "afterBalance",
        record_source AS "recordSource",
        supplier_trade_no AS "supplierTradeNo",
        remark,
        raw_payload_json AS "rawPayloadJson",
        status,
        operator_user_id AS "operatorUserId",
        operator_username AS "operatorUsername",
        synced_at AS "syncedAt",
        created_at AS "createdAt"
      FROM supplier.supplier_recharge_records
      WHERE supplier_id = ${supplierId}
      ORDER BY created_at DESC, id DESC
    `;

    return rows.map((row) => this.mapRechargeRecord(row));
  }

  async createRechargeRecord(input: {
    supplierId: string;
    rechargeType: string;
    amount: number;
    currency: string;
    beforeBalance: number;
    afterBalance: number;
    recordSource: string;
    supplierTradeNo?: string | null;
    remark?: string | null;
    rawPayloadJson: Record<string, unknown>;
    status: string;
    operatorUserId?: string | null;
    operatorUsername?: string | null;
    syncedAt?: Date | null;
  }): Promise<SupplierRechargeRecord> {
    const rows = await db<
      (SupplierRechargeRecord & {
        amount: number | string;
        beforeBalance: number | string;
        afterBalance: number | string;
      })[]
    >`
      INSERT INTO supplier.supplier_recharge_records (
        id,
        supplier_id,
        recharge_type,
        amount,
        currency,
        before_balance,
        after_balance,
        record_source,
        supplier_trade_no,
        remark,
        raw_payload_json,
        status,
        operator_user_id,
        operator_username,
        synced_at,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.rechargeType},
        ${input.amount},
        ${input.currency},
        ${input.beforeBalance},
        ${input.afterBalance},
        ${input.recordSource},
        ${input.supplierTradeNo ?? null},
        ${input.remark ?? null},
        ${JSON.stringify(input.rawPayloadJson)},
        ${input.status},
        ${input.operatorUserId ?? null},
        ${input.operatorUsername ?? null},
        ${input.syncedAt ?? null},
        NOW()
      )
      RETURNING
        id,
        supplier_id AS "supplierId",
        recharge_type AS "rechargeType",
        amount,
        currency,
        before_balance AS "beforeBalance",
        after_balance AS "afterBalance",
        record_source AS "recordSource",
        supplier_trade_no AS "supplierTradeNo",
        remark,
        raw_payload_json AS "rawPayloadJson",
        status,
        operator_user_id AS "operatorUserId",
        operator_username AS "operatorUsername",
        synced_at AS "syncedAt",
        created_at AS "createdAt"
    `;

    return this.mapRechargeRecord(rows[0] as SupplierRechargeRecord & {
      amount: number | string;
      beforeBalance: number | string;
      afterBalance: number | string;
    });
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

  async addRequestLog(input: {
    supplierId: string;
    orderNo?: string | null;
    supplierProductCode?: string | null;
    requestPayloadJson: Record<string, unknown>;
    responsePayloadJson: Record<string, unknown>;
    requestStatus: string;
    attemptNo?: number;
    durationMs: number;
  }): Promise<SupplierRequestLog> {
    const rows = await db<SupplierRequestLog[]>`
      INSERT INTO supplier.supplier_request_logs (
        id,
        supplier_id,
        order_no,
        supplier_product_code,
        request_payload_json,
        response_payload_json,
        request_status,
        attempt_no,
        duration_ms,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.orderNo ?? null},
        ${input.supplierProductCode ?? null},
        ${JSON.stringify(input.requestPayloadJson)},
        ${JSON.stringify(input.responsePayloadJson)},
        ${input.requestStatus},
        ${input.attemptNo ?? 1},
        ${input.durationMs},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        supplier_id AS "supplierId",
        order_no AS "orderNo",
        supplier_product_code AS "supplierProductCode",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        request_status AS "requestStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const log = rows[0];

    if (!log) {
      throw new Error('记录供应商请求日志失败');
    }

    return this.mapRequestLog(log);
  }

  async listLatestRequestLogsBySupplierId(
    supplierId: string,
    limit = 10,
  ): Promise<SupplierRequestLog[]> {
    const rows = await db<SupplierRequestLog[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        order_no AS "orderNo",
        supplier_product_code AS "supplierProductCode",
        request_payload_json AS "requestPayloadJson",
        response_payload_json AS "responsePayloadJson",
        request_status AS "requestStatus",
        attempt_no AS "attemptNo",
        duration_ms AS "durationMs",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.supplier_request_logs
      WHERE supplier_id = ${supplierId}
        AND created_at >= NOW() - INTERVAL '10 minutes'
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => this.mapRequestLog(row));
  }

  async listSupplierHealthMetrics(supplierIds: string[]): Promise<SupplierHealthMetrics[]> {
    if (supplierIds.length === 0) {
      return [];
    }

    const placeholders = supplierIds.map((_, index) => `$${index + 1}`).join(', ');

    return db.unsafe<SupplierHealthMetrics[]>(
      `
        SELECT
          supplier_id AS "supplierId",
          COUNT(*)::int AS "totalCount",
          COUNT(*) FILTER (WHERE request_status = 'SUCCESS')::int AS "successCount",
          COUNT(*) FILTER (WHERE request_status = 'TIMEOUT')::int AS "timeoutCount",
          COUNT(*) FILTER (
            WHERE request_status IN ('PROTOCOL_FAIL', 'OUT_OF_STOCK', 'MAINTENANCE')
          )::int AS "protocolFailCount",
          COALESCE(AVG(duration_ms), 999999)::float AS "averageDurationMs"
        FROM supplier.supplier_request_logs
        WHERE supplier_id IN (${placeholders})
          AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY supplier_id
      `,
      supplierIds,
    );
  }

  async findRuntimeBreakerBySupplierId(supplierId: string): Promise<SupplierRuntimeBreaker | null> {
    const row = await first<SupplierRuntimeBreaker>(db<SupplierRuntimeBreaker[]>`
      SELECT
        id,
        supplier_id AS "supplierId",
        breaker_status AS "breakerStatus",
        fail_count_window AS "failCountWindow",
        fail_threshold AS "failThreshold",
        opened_at AS "openedAt",
        last_probe_at AS "lastProbeAt",
        recovery_timeout_seconds AS "recoveryTimeoutSeconds",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM supplier.supplier_runtime_breakers
      WHERE supplier_id = ${supplierId}
      LIMIT 1
    `);

    return row ? this.mapRuntimeBreaker(row) : null;
  }

  async upsertRuntimeBreaker(input: {
    supplierId: string;
    breakerStatus: string;
    failCountWindow: number;
    failThreshold: number;
    openedAt?: Date | null;
    lastProbeAt?: Date | null;
    recoveryTimeoutSeconds: number;
  }): Promise<SupplierRuntimeBreaker> {
    const rows = await db<SupplierRuntimeBreaker[]>`
      INSERT INTO supplier.supplier_runtime_breakers (
        id,
        supplier_id,
        breaker_status,
        fail_count_window,
        fail_threshold,
        opened_at,
        last_probe_at,
        recovery_timeout_seconds,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.supplierId},
        ${input.breakerStatus},
        ${input.failCountWindow},
        ${input.failThreshold},
        ${input.openedAt ?? null},
        ${input.lastProbeAt ?? null},
        ${input.recoveryTimeoutSeconds},
        NOW(),
        NOW()
      )
      ON CONFLICT (supplier_id) DO UPDATE
      SET
        breaker_status = EXCLUDED.breaker_status,
        fail_count_window = EXCLUDED.fail_count_window,
        fail_threshold = EXCLUDED.fail_threshold,
        opened_at = EXCLUDED.opened_at,
        last_probe_at = EXCLUDED.last_probe_at,
        recovery_timeout_seconds = EXCLUDED.recovery_timeout_seconds,
        updated_at = NOW()
      RETURNING
        id,
        supplier_id AS "supplierId",
        breaker_status AS "breakerStatus",
        fail_count_window AS "failCountWindow",
        fail_threshold AS "failThreshold",
        opened_at AS "openedAt",
        last_probe_at AS "lastProbeAt",
        recovery_timeout_seconds AS "recoveryTimeoutSeconds",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const breaker = rows[0];

    if (!breaker) {
      throw new Error('更新供应商熔断状态失败');
    }

    return this.mapRuntimeBreaker(breaker);
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
