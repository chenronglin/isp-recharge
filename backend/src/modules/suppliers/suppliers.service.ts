import { badRequest, conflict, notFound, unauthorized } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { decryptText, encryptText, safeEqual, signOpenApiPayload } from '@/lib/security';
import { stableStringify, toAmountFen, toIsoDateTime } from '@/lib/utils';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrderRecord } from '@/modules/orders/orders.types';
import { MockSupplierAdapter } from '@/modules/suppliers/adapters/mock-supplier.adapter';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
import type { MockSupplierMode, SupplierAdapter } from '@/modules/suppliers/adapters/types';
import type { SupplierContract } from '@/modules/suppliers/contracts';
import { chooseSupplierCandidate } from '@/modules/suppliers/supplier-routing';
import type { SuppliersRepository as Repository } from '@/modules/suppliers/suppliers.repository';
import type {
  SupplierBalanceView,
  SupplierCatalogItem,
  SupplierDynamicItem,
  SupplierReconcileCandidate,
  SupplierReconcileDiff,
} from '@/modules/suppliers/suppliers.types';
import type { WorkerContract } from '@/modules/worker/contracts';

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

const supplierQueryScheduleMinutes = {
  FAST: [1, 3, 5, 10, 20, 30, 45, 60],
  MIXED: [5, 15, 30, 60, 90, 120, 150, 180],
} as const;

const runtimeBreakerFailureThreshold = 3;
const runtimeBreakerRecoveryTimeoutSeconds = 30 * 60;

type SupplierRequestStatus =
  | 'SUCCESS'
  | 'QUERYING'
  | 'TIMEOUT'
  | 'OUT_OF_STOCK'
  | 'MAINTENANCE'
  | 'PROTOCOL_FAIL';

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('timeout') || message.includes('timed out') || message.includes('abort');
}

function classifyFailureReason(reason: string): SupplierRequestStatus {
  const normalized = reason.toLowerCase();

  if (
    normalized.includes('库存不足') ||
    normalized.includes('out_of_stock') ||
    normalized.includes('out of stock')
  ) {
    return 'OUT_OF_STOCK';
  }

  if (
    normalized.includes('维护') ||
    normalized.includes('maintenance') ||
    normalized.includes('under_maintenance')
  ) {
    return 'MAINTENANCE';
  }

  return 'PROTOCOL_FAIL';
}

export class SuppliersService implements SupplierContract {
  constructor(
    private readonly repository: Repository,
    private readonly orderContract: OrderContract,
    private readonly workerContract: WorkerContract,
  ) {}

  private sanitizeNullableText(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private toSupplierDto(supplier: Awaited<ReturnType<Repository['findSupplierById']>> extends infer T
    ? T extends null
      ? never
      : T
    : never) {
    return {
      supplierId: supplier.id,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.supplierName,
      contactName: supplier.contactName,
      contactPhone: supplier.contactPhone,
      contactEmail: supplier.contactEmail,
      baseUrl: supplier.baseUrl,
      protocolType: supplier.protocolType,
      credentialMode: supplier.credentialMode,
      accessAccount: supplier.accessAccount,
      accessPassword: supplier.accessPasswordEncrypted ? '******' : null,
      cooperationStatus: supplier.cooperationStatus,
      supportsBalanceQuery: supplier.supportsBalanceQuery,
      supportsRechargeRecords: supplier.supportsRechargeRecords,
      supportsConsumptionLog: supplier.supportsConsumptionLog,
      remark: supplier.remark,
      healthStatus: supplier.healthStatus,
      lastHealthCheckAt: toIsoDateTime(supplier.lastHealthCheckAt),
      createdAt: toIsoDateTime(supplier.createdAt) ?? supplier.createdAt,
      updatedAt: toIsoDateTime(supplier.updatedAt) ?? supplier.updatedAt,
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
  }) {
    const result = await this.repository.listSuppliers(input);
    return {
      items: result.items.map((item) => this.toSupplierDto(item)),
      total: result.total,
    };
  }

  async createSupplier(input: {
    supplierCode: string;
    supplierName: string;
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    baseUrl?: string;
    protocolType: string;
    credentialMode?: string;
    accessAccount?: string;
    accessPassword?: string;
    cooperationStatus?: string;
    supportsBalanceQuery?: boolean;
    supportsRechargeRecords?: boolean;
    supportsConsumptionLog?: boolean;
    remark?: string;
    healthStatus?: string;
    status?: string;
  }) {
    const existing = await this.repository.findSupplierByCode(input.supplierCode.trim());

    if (existing) {
      throw conflict('供应商编码已存在');
    }

    const supplier = await this.repository.createSupplier({
      supplierCode: input.supplierCode.trim(),
      supplierName: input.supplierName.trim(),
      contactName: this.sanitizeNullableText(input.contactName),
      contactPhone: this.sanitizeNullableText(input.contactPhone),
      contactEmail: this.sanitizeNullableText(input.contactEmail),
      baseUrl: this.sanitizeNullableText(input.baseUrl),
      protocolType: input.protocolType.trim(),
      credentialMode: this.sanitizeNullableText(input.credentialMode) ?? 'TOKEN',
      accessAccount: this.sanitizeNullableText(input.accessAccount),
      accessPasswordEncrypted: this.sanitizeNullableText(input.accessPassword)
        ? encryptText(String(input.accessPassword))
        : null,
      cooperationStatus: this.sanitizeNullableText(input.cooperationStatus) ?? 'ACTIVE',
      supportsBalanceQuery: input.supportsBalanceQuery ?? true,
      supportsRechargeRecords: input.supportsRechargeRecords ?? false,
      supportsConsumptionLog: input.supportsConsumptionLog ?? false,
      remark: this.sanitizeNullableText(input.remark),
      healthStatus: this.sanitizeNullableText(input.healthStatus) ?? 'UNKNOWN',
      status: this.sanitizeNullableText(input.status) ?? 'ACTIVE',
    });

    return this.toSupplierDto(supplier);
  }

  async getSupplierById(supplierId: string) {
    const supplier = await this.repository.findSupplierById(supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return this.toSupplierDto(supplier);
  }

  async updateSupplier(
    supplierId: string,
    input: {
      supplierName?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      baseUrl?: string;
      protocolType?: string;
      credentialMode?: string;
      accessAccount?: string;
      accessPassword?: string;
      cooperationStatus?: string;
      supportsBalanceQuery?: boolean;
      supportsRechargeRecords?: boolean;
      supportsConsumptionLog?: boolean;
      remark?: string;
      healthStatus?: string;
      status?: string;
    },
  ) {
    const existing = await this.repository.findSupplierById(supplierId);

    if (!existing) {
      throw notFound('供应商不存在');
    }

    const updated = await this.repository.updateSupplier(supplierId, {
      supplierName: this.sanitizeNullableText(input.supplierName) ?? existing.supplierName,
      contactName: this.sanitizeNullableText(input.contactName),
      contactPhone: this.sanitizeNullableText(input.contactPhone),
      contactEmail: this.sanitizeNullableText(input.contactEmail),
      baseUrl: this.sanitizeNullableText(input.baseUrl),
      protocolType: this.sanitizeNullableText(input.protocolType) ?? existing.protocolType,
      credentialMode: this.sanitizeNullableText(input.credentialMode) ?? existing.credentialMode,
      accessAccount: this.sanitizeNullableText(input.accessAccount),
      accessPasswordEncrypted: this.sanitizeNullableText(input.accessPassword)
        ? encryptText(String(input.accessPassword))
        : null,
      cooperationStatus:
        this.sanitizeNullableText(input.cooperationStatus) ?? existing.cooperationStatus,
      supportsBalanceQuery: input.supportsBalanceQuery ?? existing.supportsBalanceQuery,
      supportsRechargeRecords: input.supportsRechargeRecords ?? existing.supportsRechargeRecords,
      supportsConsumptionLog: input.supportsConsumptionLog ?? existing.supportsConsumptionLog,
      remark: this.sanitizeNullableText(input.remark),
      healthStatus: this.sanitizeNullableText(input.healthStatus) ?? existing.healthStatus,
      status: this.sanitizeNullableText(input.status) ?? existing.status,
    });

    if (!updated) {
      throw notFound('供应商不存在');
    }

    return this.toSupplierDto(updated);
  }

  async getSupplierBalance(input: { supplierId: string }): Promise<SupplierBalanceView> {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const latest = await this.repository.findLatestBalanceSnapshot(supplier.id);

    if (!latest) {
      return this.refreshSupplierBalance(input);
    }

    return {
      supplierId: latest.supplierId,
      balanceAmountFen: toAmountFen(latest.balanceAmount) ?? 0,
      currency: latest.currency,
      balanceStatus: latest.balanceStatus,
      sourceType: latest.sourceType,
      queriedAt: toIsoDateTime(latest.queriedAt) ?? latest.queriedAt,
      rawPayload: latest.rawPayloadJson,
    };
  }

  async refreshSupplierBalance(input: { supplierId: string }): Promise<SupplierBalanceView> {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.getBalance) {
      throw badRequest('当前供应商不支持余额查询');
    }

    const startedAt = Date.now();

    try {
      const result = await adapter.getBalance();

      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'GET_BALANCE',
        },
        responsePayloadJson: result as unknown as Record<string, unknown>,
        requestStatus: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      const snapshot = await this.repository.addBalanceSnapshot({
        supplierId: supplier.id,
        balanceAmount: Number(result.agentBalance ?? 0),
        currency: 'CNY',
        balanceStatus: result.errorCode === 0 ? 'AVAILABLE' : 'ERROR',
        sourceType: 'API_QUERY',
        rawPayloadJson: result as unknown as Record<string, unknown>,
      });

      return {
        supplierId: snapshot.supplierId,
        balanceAmountFen: toAmountFen(snapshot.balanceAmount) ?? 0,
        currency: snapshot.currency,
        balanceStatus: snapshot.balanceStatus,
        sourceType: snapshot.sourceType,
        queriedAt: toIsoDateTime(snapshot.queriedAt) ?? snapshot.queriedAt,
        rawPayload: snapshot.rawPayloadJson,
      };
    } catch (error) {
      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'GET_BALANCE',
        },
        responsePayloadJson: {
          errorMessage: error instanceof Error ? error.message : '供应商余额查询失败',
        },
        requestStatus: isTimeoutError(error) ? 'TIMEOUT' : 'PROTOCOL_FAIL',
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplier.id);
      throw error;
    }
  }

  async getSupplierHealth(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const latest = await this.repository.findLatestHealthCheck(supplier.id);

    if (!latest) {
      return {
        supplierId: supplier.id,
        healthStatus: supplier.healthStatus,
        httpStatus: null,
        message: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        checkedAt: toIsoDateTime(supplier.lastHealthCheckAt),
      };
    }

    return {
      supplierId: latest.supplierId,
      healthStatus: latest.healthStatus,
      httpStatus: latest.httpStatus,
      message: latest.message,
      lastSuccessAt: toIsoDateTime(latest.lastSuccessAt),
      lastFailureAt: toIsoDateTime(latest.lastFailureAt),
      checkedAt: toIsoDateTime(latest.checkedAt) ?? latest.checkedAt,
    };
  }

  async listConsumptionLogs(input: {
    supplierId: string;
    startTime?: string | null;
    endTime?: string | null;
    mobile?: string;
    orderNo?: string;
    supplierOrderNo?: string;
  }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    if (!supplier.supportsConsumptionLog) {
      throw badRequest('当前供应商不支持消费日志');
    }

    const rows = await this.repository.listConsumptionLogs(input);
    return rows.map((row) => ({
      id: row.id,
      supplierId: row.supplierId,
      mobile: row.mobile,
      orderNo: row.orderNo,
      supplierOrderNo: row.supplierOrderNo,
      amountFen: toAmountFen(row.amount) ?? 0,
      status: row.status,
      occurredAt: toIsoDateTime(row.occurredAt) ?? row.occurredAt,
      rawPayload: row.rawPayloadJson,
    }));
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
    await this.getSupplierById(input.supplierId);
    const rows = await this.repository.listSupplierProducts(input);
    return rows.map((row) => ({
      snapshotId: row.snapshotId,
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierProductCode: row.supplierProductCode,
      productName: row.productName,
      carrierCode: row.carrierCode,
      province: row.province,
      faceValueFen: toAmountFen(Number(row.faceValue)) ?? 0,
      costPriceFen: toAmountFen(Number(row.costPrice)) ?? 0,
      saleStatus: row.saleStatus,
      stockStatus: row.stockStatus,
      arrivalSla: row.arrivalSla,
      rechargeRange: row.rechargeRange,
      updatedAt: toIsoDateTime(row.updatedAt) ?? row.updatedAt,
      rawPayload: row.rawPayload,
    }));
  }

  async triggerCatalogSync(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.syncCatalog) {
      throw badRequest('当前供应商不支持目录同步');
    }

    return this.pullFullCatalogForSupplier(supplier);
  }

  async listSyncLogs(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return this.repository.listSyncLogsBySupplierId(input.supplierId);
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
    updatedBy?: string | null;
  }) {
    await this.repository.upsertConfig(input);
    const config = await this.repository.findConfigBySupplierId(input.supplierId);

    if (!config) {
      throw notFound('供应商配置不存在');
    }

    return {
      supplierId: config.supplierId,
      timeoutMs: config.timeoutMs,
      credential: '******',
      callbackSecret: '******',
      configJson: config.configJson,
      updatedAt: toIsoDateTime(config.updatedAt) ?? null,
      updatedBy: config.updatedBy ?? null,
    };
  }

  async listRechargeRecords(input: { supplierId: string }) {
    await this.getSupplierById(input.supplierId);
    const rows = await this.repository.listRechargeRecords(input.supplierId);
    return rows.map((row) => ({
      recordId: row.id,
      supplierId: row.supplierId,
      rechargeType: row.rechargeType,
      amountFen: toAmountFen(row.amount) ?? 0,
      currency: row.currency,
      beforeBalanceFen: toAmountFen(row.beforeBalance) ?? 0,
      afterBalanceFen: toAmountFen(row.afterBalance) ?? 0,
      recordSource: row.recordSource,
      supplierTradeNo: row.supplierTradeNo,
      remark: row.remark,
      rawPayload: row.rawPayloadJson,
      status: row.status,
      operatorUserId: row.operatorUserId,
      operatorUsername: row.operatorUsername,
      createdAt: toIsoDateTime(row.createdAt) ?? row.createdAt,
    }));
  }

  async createRechargeRecord(input: {
    supplierId: string;
    rechargeType: string;
    amountFen: number;
    currency?: string;
    beforeBalanceFen?: number;
    afterBalanceFen?: number;
    recordSource: string;
    supplierTradeNo?: string;
    remark?: string;
    rawPayload?: Record<string, unknown>;
    status?: string;
    operatorUserId?: string | null;
    operatorUsername?: string | null;
  }) {
    await this.getSupplierById(input.supplierId);
    const record = await this.repository.createRechargeRecord({
      supplierId: input.supplierId,
      rechargeType: input.rechargeType,
      amount: input.amountFen / 100,
      currency: input.currency ?? 'CNY',
      beforeBalance: (input.beforeBalanceFen ?? 0) / 100,
      afterBalance: (input.afterBalanceFen ?? 0) / 100,
      recordSource: input.recordSource,
      supplierTradeNo: this.sanitizeNullableText(input.supplierTradeNo),
      remark: this.sanitizeNullableText(input.remark),
      rawPayloadJson: input.rawPayload ?? {},
      status: input.status ?? 'SUCCESS',
      operatorUserId: input.operatorUserId ?? null,
      operatorUsername: input.operatorUsername ?? null,
      syncedAt: input.recordSource === 'API_SYNC' ? new Date() : null,
    });

    return {
      recordId: record.id,
      supplierId: record.supplierId,
      rechargeType: record.rechargeType,
      amountFen: toAmountFen(record.amount) ?? 0,
      currency: record.currency,
      beforeBalanceFen: toAmountFen(record.beforeBalance) ?? 0,
      afterBalanceFen: toAmountFen(record.afterBalance) ?? 0,
      recordSource: record.recordSource,
      supplierTradeNo: record.supplierTradeNo,
      remark: record.remark,
      rawPayload: record.rawPayloadJson,
      status: record.status,
      operatorUserId: record.operatorUserId,
      operatorUsername: record.operatorUsername,
      createdAt: toIsoDateTime(record.createdAt) ?? record.createdAt,
    };
  }

  async listReconcileDiffs(input?: { reconcileDate?: string; orderNo?: string }) {
    return this.repository.listReconcileDiffs(input);
  }

  async recoverCircuitBreaker(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return this.repository.upsertRuntimeBreaker({
      supplierId: supplier.id,
      breakerStatus: 'CLOSED',
      failCountWindow: 0,
      failThreshold: runtimeBreakerFailureThreshold,
      openedAt: null,
      lastProbeAt: new Date(),
      recoveryTimeoutSeconds: runtimeBreakerRecoveryTimeoutSeconds,
    });
  }

  async syncFullCatalog(input: {
    supplierCode: string;
    items: SupplierCatalogItem[];
  }): Promise<{ syncedProducts: string[] }> {
    const supplier = await this.requireSupplierByCode(input.supplierCode);

    try {
      const syncedProducts: string[] = [];

      for (const item of input.items) {
        const product = await this.repository.findRechargeProductByBusinessKey(item);

        if (!product) {
          continue;
        }

        await this.repository.upsertProductSupplierMapping({
          productId: product.id,
          supplierId: supplier.id,
          item,
        });

        syncedProducts.push(product.productCode);
      }

      const currentMappings = await this.repository.listMappingsBySupplierId(supplier.id);

      for (const mapping of currentMappings) {
        if (syncedProducts.includes(mapping.productCode)) {
          continue;
        }

        await this.repository.deactivateProductSupplierMapping({
          productId: mapping.productId,
          supplierId: supplier.id,
        });
      }

      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'FULL',
        status: 'SUCCESS',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {
          syncedProducts,
        },
      });

      return {
        syncedProducts,
      };
    } catch (error) {
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'FULL',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商全量目录同步失败',
      });
      throw error;
    }
  }

  async syncDynamicCatalog(input: {
    supplierCode: string;
    items: SupplierDynamicItem[];
  }): Promise<{ updatedProducts: string[] }> {
    const supplier = await this.requireSupplierByCode(input.supplierCode);

    try {
      const updatedProducts: string[] = [];

      for (const item of input.items) {
        const updated = await this.repository.updateDynamicCatalogItem({
          supplierId: supplier.id,
          item,
        });

        if (updated) {
          updatedProducts.push(updated.productCode);
        }
      }

      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'DYNAMIC',
        status: 'SUCCESS',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {
          updatedProducts,
        },
      });

      return {
        updatedProducts,
      };
    } catch (error) {
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'DYNAMIC',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: input.supplierCode,
          itemCount: input.items.length,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商动态目录同步失败',
      });
      throw error;
    }
  }

  async submitOrder(payload: { orderNo: string }) {
    const order = await this.orderContract.getSupplierExecutionContext(payload.orderNo);

    if (
      ['SUCCESS', 'REFUNDED', 'REFUNDING', 'CLOSED'].includes(order.mainStatus) ||
      order.refundStatus === 'PENDING'
    ) {
      return;
    }

    const primarySupplier = await this.getPrimarySupplierCandidate(order);
    const existing = await this.repository.findSupplierOrderByOrderNo(payload.orderNo);

    if (existing) {
      return;
    }

    const adapter = await this.getAdapterBySupplierId(String(primarySupplier.supplierId));
    const requestPayload = {
      orderNo: payload.orderNo,
      productId: order.matchedProductId,
      supplierProductCode: String(primarySupplier.supplierProductCode),
      mobile: order.mobile,
      faceValue: order.faceValue,
      ispName: order.ispName ?? undefined,
      province: order.province ?? undefined,
      callbackUrl: String(
        (order.callbackSnapshotJson.callbackConfig as Record<string, unknown> | undefined)
          ?.callbackUrl ?? '',
      ),
    };
    const startedAt = Date.now();
    let submitResult: Awaited<ReturnType<SupplierAdapter['submitOrder']>>;

    try {
      submitResult = await adapter.submitOrder(requestPayload);
      await this.repository.addRequestLog({
        supplierId: String(primarySupplier.supplierId),
        orderNo: payload.orderNo,
        supplierProductCode: String(primarySupplier.supplierProductCode),
        requestPayloadJson: requestPayload,
        responsePayloadJson: submitResult as Record<string, unknown>,
        requestStatus: 'SUCCESS',
        attemptNo: 1,
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(String(primarySupplier.supplierId));
    } catch (error) {
      const requestStatus = isTimeoutError(error)
        ? 'TIMEOUT'
        : classifyFailureReason(error instanceof Error ? error.message : '供应商提单失败');

      await this.repository.addRequestLog({
        supplierId: String(primarySupplier.supplierId),
        orderNo: payload.orderNo,
        supplierProductCode: String(primarySupplier.supplierProductCode),
        requestPayloadJson: requestPayload,
        responsePayloadJson: {
          errorMessage: error instanceof Error ? error.message : '供应商提单失败',
        },
        requestStatus,
        attemptNo: 1,
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(String(primarySupplier.supplierId));
      throw error;
    }

    const supplierOrder = await this.repository.createSupplierOrder({
      orderNo: payload.orderNo,
      supplierId: String(primarySupplier.supplierId),
      supplierOrderNo: submitResult.supplierOrderNo,
      requestPayloadJson: {
        orderNo: payload.orderNo,
        productId: order.matchedProductId,
      },
      responsePayloadJson: {
        accepted: true,
        supplierOrderNo: submitResult.supplierOrderNo,
      },
      standardStatus: submitResult.status,
    });

    await eventBus.publish('SupplierAccepted', {
      orderNo: payload.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: supplierOrder.supplierOrderNo,
      status: submitResult.status,
    });

    for (const [attemptIndex, minute] of supplierQueryScheduleMinutes[
      order.requestedProductType
    ].entries()) {
      await this.workerContract.schedule({
        jobType: 'supplier.query',
        businessKey: `${payload.orderNo}:query:${attemptIndex}`,
        payload: {
          orderNo: payload.orderNo,
          supplierOrderNo: supplierOrder.supplierOrderNo,
          attemptIndex,
        },
        nextRunAt: new Date(Date.now() + minute * 60 * 1000),
      });
    }
  }

  async queryOrder(payload: { orderNo: string; supplierOrderNo: string; attemptIndex: number }) {
    const order = await this.orderContract.getSupplierExecutionContext(payload.orderNo);
    const supplierOrder = await this.repository.findSupplierOrderBySupplierOrderNo(
      payload.supplierOrderNo,
    );

    if (!supplierOrder) {
      throw notFound('供应商订单不存在');
    }

    if (['SUCCESS', 'REFUNDED', 'REFUNDING', 'CLOSED'].includes(order.mainStatus)) {
      return;
    }

    const adapter = await this.getAdapterBySupplierId(supplierOrder.supplierId);
    const requestPayload = {
      supplierOrderNo: payload.supplierOrderNo,
      attemptIndex: payload.attemptIndex,
      orderNo: payload.orderNo,
    };
    const startedAt = Date.now();
    let queryResult: Awaited<ReturnType<SupplierAdapter['queryOrder']>>;

    try {
      queryResult = await adapter.queryOrder(requestPayload);
      await this.repository.addRequestLog({
        supplierId: supplierOrder.supplierId,
        orderNo: payload.orderNo,
        requestPayloadJson: requestPayload,
        responsePayloadJson: queryResult as Record<string, unknown>,
        requestStatus:
          queryResult.status === 'SUCCESS'
            ? 'SUCCESS'
            : queryResult.status === 'QUERYING'
              ? 'QUERYING'
              : classifyFailureReason(queryResult.reason ?? '供应商查单失败'),
        attemptNo: payload.attemptIndex + 1,
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplierOrder.supplierId);
    } catch (error) {
      await this.repository.addRequestLog({
        supplierId: supplierOrder.supplierId,
        orderNo: payload.orderNo,
        requestPayloadJson: requestPayload,
        responsePayloadJson: {
          errorMessage: error instanceof Error ? error.message : '供应商查单失败',
        },
        requestStatus: isTimeoutError(error)
          ? 'TIMEOUT'
          : classifyFailureReason(error instanceof Error ? error.message : '供应商查单失败'),
        attemptNo: payload.attemptIndex + 1,
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplierOrder.supplierId);
      throw error;
    }

    if (queryResult.status === 'FAIL') {
      await this.repository.updateSupplierOrderStatus(payload.supplierOrderNo, 'FAIL', {
        result: 'FAIL',
        attemptIndex: payload.attemptIndex,
      });
      await eventBus.publish('SupplierFailed', {
        orderNo: payload.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: payload.supplierOrderNo,
        reason: queryResult.reason ?? '模拟供应商履约失败',
      });
      return;
    }

    if (queryResult.status === 'QUERYING') {
      await this.repository.updateSupplierOrderStatus(payload.supplierOrderNo, 'QUERYING', {
        result: 'QUERYING',
        attemptIndex: payload.attemptIndex,
      });
      await eventBus.publish('SupplierAccepted', {
        orderNo: payload.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: payload.supplierOrderNo,
        status: 'PROCESSING',
      });
      return;
    }

    await this.repository.updateSupplierOrderStatus(payload.supplierOrderNo, 'SUCCESS', {
      result: 'SUCCESS',
      attemptIndex: payload.attemptIndex,
    });
    await eventBus.publish('SupplierSucceeded', {
      orderNo: payload.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: payload.supplierOrderNo,
      costPrice: order.purchasePrice,
    });
  }

  async runInflightReconcile(): Promise<SupplierReconcileDiff[]> {
    return this.collectReconcileDiffs({
      reconcileDate: getTodayDateString(),
      onlyInflight: true,
    });
  }

  async runDailyReconcile(
    input: { reconcileDate?: string } = {},
  ): Promise<SupplierReconcileDiff[]> {
    return this.collectReconcileDiffs({
      reconcileDate: input.reconcileDate ?? getTodayDateString(),
      onlyInflight: false,
    });
  }

  async handleSupplierSubmitJob(payload: Record<string, unknown>) {
    await this.submitOrder({
      orderNo: String(payload.orderNo ?? ''),
    });
  }

  async handleCatalogFullSyncJob(payload: Record<string, unknown>) {
    if (
      typeof payload.supplierCode === 'string' &&
      Array.isArray(payload.items) &&
      payload.items.length > 0
    ) {
      await this.syncFullCatalog({
        supplierCode: payload.supplierCode,
        items: payload.items as SupplierCatalogItem[],
      });
      return;
    }

    await this.pullFullCatalog({
      supplierCode: typeof payload.supplierCode === 'string' ? payload.supplierCode : undefined,
    });
  }

  async handleCatalogDeltaSyncJob(payload: Record<string, unknown>) {
    if (
      typeof payload.supplierCode === 'string' &&
      Array.isArray(payload.items) &&
      payload.items.length > 0
    ) {
      await this.syncDynamicCatalog({
        supplierCode: payload.supplierCode,
        items: payload.items as SupplierDynamicItem[],
      });
      return;
    }

    await this.pullDynamicCatalog({
      supplierCode: typeof payload.supplierCode === 'string' ? payload.supplierCode : undefined,
    });
  }

  async handleSupplierQueryJob(payload: Record<string, unknown>) {
    await this.queryOrder({
      orderNo: String(payload.orderNo ?? ''),
      supplierOrderNo: String(payload.supplierOrderNo ?? ''),
      attemptIndex: Number(payload.attemptIndex ?? 0),
    });
  }

  async handleReconcileJob(payload: Record<string, unknown>) {
    if (payload.onlyInflight === true) {
      await this.runInflightReconcile();
      return;
    }

    await this.runDailyReconcile({
      reconcileDate: typeof payload.reconcileDate === 'string' ? payload.reconcileDate : undefined,
    });
  }

  async handleSupplierCallback(
    supplierCode: string,
    input: {
      headers: Record<string, unknown>;
      body: Record<string, unknown>;
      rawBody?: string;
      contentType?: string;
    },
  ) {
    const supplier = await this.repository.findSupplierByCode(supplierCode);
    const adapter = await this.getAdapter(supplierCode);
    const parsed = await adapter.parseCallback({
      headers: input.headers,
      body: input.body,
      rawBody: input.rawBody,
      contentType: input.contentType,
    });
    const callbackParsed = parsed as typeof parsed & {
      mappedStatus?: 'QUERYING' | 'SUCCESS' | 'FAIL';
      signatureValid?: boolean;
    };
    const mappedStatus =
      callbackParsed.mappedStatus ?? (parsed.status === 'SUCCESS' ? 'SUCCESS' : 'FAIL');
    const isSignatureValid =
      typeof callbackParsed.signatureValid === 'boolean'
        ? callbackParsed.signatureValid
        : await this.verifySupplierCallbackSignature(
            supplier?.id ?? null,
            input.headers,
            input.body,
          );
    const supplierOrder = await this.repository.findSupplierOrderBySupplierOrderNo(
      parsed.supplierOrderNo,
    );

    await this.repository.addCallbackLog({
      supplierId: supplier?.id ?? null,
      supplierCode,
      supplierOrderNo: parsed.supplierOrderNo,
      headersJson: input.headers,
      bodyJson: input.body,
      signatureValid: isSignatureValid,
      parsedStatus: mappedStatus,
      idempotencyKey: `${parsed.supplierOrderNo}:${mappedStatus}`,
    });

    if (!isSignatureValid) {
      throw unauthorized('供应商回调签名校验失败');
    }

    if (!supplierOrder) {
      throw notFound('供应商订单不存在');
    }

    if (mappedStatus === 'QUERYING') {
      await this.repository.updateSupplierOrderStatus(parsed.supplierOrderNo, 'QUERYING', {
        from: 'callback',
      });
      await eventBus.publish('SupplierAccepted', {
        orderNo: supplierOrder.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: parsed.supplierOrderNo,
        status: 'PROCESSING',
      });
      return;
    }

    if (parsed.status === 'SUCCESS') {
      await this.repository.updateSupplierOrderStatus(parsed.supplierOrderNo, 'SUCCESS', {
        from: 'callback',
      });
      const order = await this.orderContract.getSupplierExecutionContext(supplierOrder.orderNo);
      await eventBus.publish('SupplierSucceeded', {
        orderNo: supplierOrder.orderNo,
        supplierId: supplierOrder.supplierId,
        supplierOrderNo: parsed.supplierOrderNo,
        costPrice: order.purchasePrice,
      });
      return;
    }

    await this.repository.updateSupplierOrderStatus(parsed.supplierOrderNo, 'FAIL', {
      from: 'callback',
      reason: parsed.reason ?? 'callback fail',
    });
    await eventBus.publish('SupplierFailed', {
      orderNo: supplierOrder.orderNo,
      supplierId: supplierOrder.supplierId,
      supplierOrderNo: parsed.supplierOrderNo,
      reason: parsed.reason ?? 'callback fail',
    });
  }

  private async requireSupplierByCode(supplierCode: string) {
    const supplier = await this.repository.findSupplierByCode(supplierCode);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return supplier;
  }

  async getAdapter(supplierCode: string): Promise<SupplierAdapter> {
    const supplier = await this.requireSupplierByCode(supplierCode);
    const config = await this.repository.findConfigBySupplierId(supplier.id);
    const mode = (config?.configJson.mode ?? 'mock-auto-success') as MockSupplierMode;

    if (supplier.supplierCode === 'mock-supplier') {
      return new MockSupplierAdapter(mode);
    }

    if (supplier.supplierCode === 'shenzhen-kefei') {
      const configJson = config?.configJson ?? {};
      const credentialRaw = config ? decryptText(config.credentialEncrypted) : '{}';
      let credential: {
        agentAccount?: string;
        md5Key?: string;
        baseUrl?: string;
        callbackUrl?: string;
      } = {};

      try {
        credential = JSON.parse(credentialRaw) as typeof credential;
      } catch {
        credential = {};
      }

      return new ShenzhenKefeiAdapter({
        baseUrl: String(
          credential.baseUrl ?? configJson.baseUrl ?? 'http://api.sohan.hk:50080/API',
        ),
        agentAccount: String(credential.agentAccount ?? ''),
        md5Key: String(credential.md5Key ?? ''),
        callbackUrl: String(credential.callbackUrl ?? configJson.callbackUrl ?? ''),
      });
    }

    throw badRequest(`未配置供应商适配器: ${supplier.supplierCode}`);
  }

  private async getAdapterBySupplierId(supplierId: string): Promise<SupplierAdapter> {
    const supplier = await this.repository.findSupplierById(supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return this.getAdapter(supplier.supplierCode);
  }

  private async pullFullCatalog(input: { supplierCode?: string } = {}) {
    const suppliers = await this.listSyncableSuppliers(input.supplierCode);

    for (const supplier of suppliers) {
      await this.pullFullCatalogForSupplier(supplier);
    }
  }

  private async pullDynamicCatalog(input: { supplierCode?: string } = {}) {
    const suppliers = await this.listSyncableSuppliers(input.supplierCode);

    for (const supplier of suppliers) {
      await this.pullDynamicCatalogForSupplier(supplier);
    }
  }

  private async pullFullCatalogForSupplier(supplier: {
    id: string;
    supplierCode: string;
  }): Promise<{ supplierCode: string; syncedProducts: string[] }> {
    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.syncCatalog) {
      throw badRequest('当前供应商不支持目录同步');
    }

    const startedAt = Date.now();

    try {
      const result = await adapter.syncCatalog();
      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'SYNC_CATALOG_FULL',
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {
          itemCount: result.items.length,
        },
        requestStatus: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplier.id);

      const synced = await this.syncFullCatalog({
        supplierCode: supplier.supplierCode,
        items: result.items,
      });

      return {
        supplierCode: supplier.supplierCode,
        syncedProducts: synced.syncedProducts,
      };
    } catch (error) {
      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'SYNC_CATALOG_FULL',
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {
          errorMessage: error instanceof Error ? error.message : '供应商全量目录同步失败',
        },
        requestStatus: isTimeoutError(error) ? 'TIMEOUT' : 'PROTOCOL_FAIL',
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplier.id);
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'FULL',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商全量目录同步失败',
      });
      throw error;
    }
  }

  private async pullDynamicCatalogForSupplier(supplier: {
    id: string;
    supplierCode: string;
  }): Promise<{ supplierCode: string; updatedProducts: string[] }> {
    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.syncCatalog) {
      throw badRequest('当前供应商不支持动态目录同步');
    }

    const startedAt = Date.now();

    try {
      const result = await adapter.syncCatalog();
      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'SYNC_CATALOG_DYNAMIC',
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {
          itemCount: result.items.length,
        },
        requestStatus: 'SUCCESS',
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplier.id);

      const updated = await this.syncDynamicCatalog({
        supplierCode: supplier.supplierCode,
        items: result.items.map((item) => ({
          productCode: item.productCode,
          salesStatus: item.salesStatus ?? 'ON_SALE',
          purchasePrice: item.purchasePrice,
          inventoryQuantity: item.inventoryQuantity,
        })),
      });

      return {
        supplierCode: supplier.supplierCode,
        updatedProducts: updated.updatedProducts,
      };
    } catch (error) {
      await this.repository.addRequestLog({
        supplierId: supplier.id,
        requestPayloadJson: {
          action: 'SYNC_CATALOG_DYNAMIC',
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {
          errorMessage: error instanceof Error ? error.message : '供应商动态目录同步失败',
        },
        requestStatus: isTimeoutError(error) ? 'TIMEOUT' : 'PROTOCOL_FAIL',
        durationMs: Date.now() - startedAt,
      });
      await this.refreshRuntimeBreakerState(supplier.id);
      await this.repository.addProductSyncLog({
        supplierId: supplier.id,
        syncType: 'DYNAMIC',
        status: 'FAIL',
        requestPayloadJson: {
          supplierCode: supplier.supplierCode,
        },
        responsePayloadJson: {},
        errorMessage: error instanceof Error ? error.message : '供应商动态目录同步失败',
      });
      throw error;
    }
  }

  private async listSyncableSuppliers(supplierCode?: string) {
    if (supplierCode) {
      return [await this.requireSupplierByCode(supplierCode)];
    }

    const { items: suppliers } = await this.repository.listSuppliers();
    const syncableSuppliers = [];

    for (const supplier of suppliers) {
      const adapter = await this.getAdapter(supplier.supplierCode).catch(() => null);

      if (adapter?.syncCatalog) {
        syncableSuppliers.push(supplier);
      }
    }

    return syncableSuppliers;
  }

  private async isSupplierBreakerOpen(supplierId: string): Promise<boolean> {
    const breaker = await this.repository.findRuntimeBreakerBySupplierId(supplierId);

    if (!breaker || breaker.breakerStatus !== 'OPEN') {
      return false;
    }

    if (!breaker.openedAt) {
      return true;
    }

    const expiresAt =
      new Date(breaker.openedAt).getTime() + breaker.recoveryTimeoutSeconds * 1000;

    if (expiresAt > Date.now()) {
      return true;
    }

    await this.repository.upsertRuntimeBreaker({
      supplierId,
      breakerStatus: 'CLOSED',
      failCountWindow: 0,
      failThreshold: runtimeBreakerFailureThreshold,
      openedAt: null,
      lastProbeAt: new Date(),
      recoveryTimeoutSeconds: runtimeBreakerRecoveryTimeoutSeconds,
    });

    return false;
  }

  private async refreshRuntimeBreakerState(supplierId: string): Promise<void> {
    const recentLogs = await this.repository.listLatestRequestLogsBySupplierId(
      supplierId,
      10,
    );
    const latestStatus = recentLogs[0]?.requestStatus ?? null;
    const breakerStatuses = recentLogs
      .map((log) => log.requestStatus)
      .filter((status) => ['OUT_OF_STOCK', 'MAINTENANCE', 'PROTOCOL_FAIL'].includes(status));
    const consecutiveStatus = breakerStatuses[0] ?? null;
    const consecutiveCount =
      consecutiveStatus && ['OUT_OF_STOCK', 'MAINTENANCE', 'PROTOCOL_FAIL'].includes(consecutiveStatus)
        ? breakerStatuses.findIndex((status) => status !== consecutiveStatus) === -1
          ? breakerStatuses.length
          : breakerStatuses.findIndex((status) => status !== consecutiveStatus)
        : 0;
    const shouldOpen =
      latestStatus !== 'SUCCESS' &&
      latestStatus !== 'QUERYING' &&
      consecutiveStatus !== null &&
      ['OUT_OF_STOCK', 'MAINTENANCE', 'PROTOCOL_FAIL'].includes(consecutiveStatus) &&
      consecutiveCount >= runtimeBreakerFailureThreshold;

    await this.repository.upsertRuntimeBreaker({
      supplierId,
      breakerStatus: shouldOpen ? 'OPEN' : 'CLOSED',
      failCountWindow: shouldOpen ? consecutiveCount : 0,
      failThreshold: runtimeBreakerFailureThreshold,
      openedAt: shouldOpen ? new Date() : null,
      lastProbeAt: new Date(),
      recoveryTimeoutSeconds: runtimeBreakerRecoveryTimeoutSeconds,
    });
  }

  private async getPrimarySupplierCandidate(order: OrderRecord) {
    const supplierCandidates = (order.supplierRouteSnapshotJson.supplierCandidates ?? []) as Array<
      Record<string, unknown>
    >;
    const normalizedCandidates = supplierCandidates.map((candidate) => ({
      ...candidate,
      supplierId: String(candidate.supplierId ?? ''),
      supplierProductCode: String(candidate.supplierProductCode ?? ''),
      priority: Number(candidate.priority ?? Number.MAX_SAFE_INTEGER),
      costPrice: Number(candidate.costPrice ?? Number.MAX_SAFE_INTEGER),
    }));
    const availableCandidates: Array<{
      supplierId: string;
      supplierProductCode: string;
      priority: number;
      costPrice: number;
      successRate: number;
      stabilityScore: number;
      profit: number;
      averageDurationMs: number;
      [key: string]: unknown;
    }> = [];
    const healthRows = await this.repository.listSupplierHealthMetrics(
      normalizedCandidates.map((candidate) => candidate.supplierId),
    );
    const healthMap = new Map(healthRows.map((row) => [row.supplierId, row]));

    for (const candidate of normalizedCandidates) {
      if (await this.isSupplierBreakerOpen(candidate.supplierId)) {
        continue;
      }

      const health = healthMap.get(candidate.supplierId);
      const totalCount = Number(health?.totalCount ?? 0);
      const successCount = Number(health?.successCount ?? 0);
      const timeoutCount = Number(health?.timeoutCount ?? 0);
      const protocolFailCount = Number(health?.protocolFailCount ?? 0);
      const successRate = totalCount > 0 ? successCount / totalCount : 1;
      const stabilityScore =
        totalCount > 0 ? 1 - (timeoutCount + protocolFailCount) / totalCount : 1;

      availableCandidates.push({
        ...candidate,
        successRate,
        stabilityScore,
        profit: Number(order.salePrice) - Number(candidate.costPrice),
        averageDurationMs: Number(health?.averageDurationMs ?? 999999),
      });
    }
    const primarySupplier = chooseSupplierCandidate(availableCandidates);

    if (!primarySupplier) {
      throw badRequest('订单缺少可用供应商候选映射');
    }

    return primarySupplier;
  }

  private async verifySupplierCallbackSignature(
    supplierId: string | null,
    headers: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    if (!supplierId) {
      return false;
    }

    const config = await this.repository.findConfigBySupplierId(supplierId);

    if (!config) {
      return false;
    }

    const providedSignature = String(headers.sign ?? '');

    if (!providedSignature) {
      return false;
    }

    const expectedSignature = signOpenApiPayload(
      decryptText(config.callbackSecretEncrypted),
      stableStringify(body),
    );

    return safeEqual(expectedSignature, providedSignature);
  }

  private buildDiffFromCandidate(
    candidate: SupplierReconcileCandidate,
    reconcileDate: string,
    onlyInflight: boolean,
  ): {
    supplierId: string;
    reconcileDate: string;
    orderNo: string;
    diffType: string;
    diffAmount: number;
    detailsJson: Record<string, unknown>;
  } | null {
    if (
      candidate.platformMainStatus === 'REFUNDED' &&
      candidate.supplierOrderStatus === 'SUCCESS'
    ) {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'PLATFORM_REFUNDED_SUPPLIER_SUCCESS',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    if (candidate.platformMainStatus === 'SUCCESS' && candidate.supplierOrderStatus === 'FAIL') {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'PLATFORM_SUCCESS_SUPPLIER_FAIL',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    if (
      onlyInflight &&
      candidate.platformMainStatus === 'PROCESSING' &&
      ['SUCCESS', 'FAIL'].includes(candidate.supplierOrderStatus)
    ) {
      return {
        supplierId: candidate.supplierId,
        reconcileDate,
        orderNo: candidate.orderNo,
        diffType: 'INFLIGHT_STATUS_MISMATCH',
        diffAmount: candidate.purchasePrice,
        detailsJson: {
          platformMainStatus: candidate.platformMainStatus,
          platformSupplierStatus: candidate.platformSupplierStatus,
          refundStatus: candidate.refundStatus,
          supplierOrderStatus: candidate.supplierOrderStatus,
          supplierOrderNo: candidate.supplierOrderNo,
        },
      };
    }

    return null;
  }

  private async collectReconcileDiffs(input: {
    reconcileDate: string;
    onlyInflight: boolean;
  }): Promise<SupplierReconcileDiff[]> {
    const candidates = await this.repository.listReconcileCandidates(input);
    const diffs: SupplierReconcileDiff[] = [];

    for (const candidate of candidates) {
      const builtDiff = this.buildDiffFromCandidate(
        candidate,
        input.reconcileDate,
        input.onlyInflight,
      );

      if (!builtDiff) {
        continue;
      }

      diffs.push(await this.repository.upsertReconcileDiff(builtDiff));
    }

    return diffs;
  }
}
