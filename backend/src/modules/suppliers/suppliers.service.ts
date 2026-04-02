import { badRequest, notFound, unauthorized } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { decryptText, safeEqual, signOpenApiPayload } from '@/lib/security';
import { stableStringify } from '@/lib/utils';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrderRecord } from '@/modules/orders/orders.types';
import { MockSupplierAdapter } from '@/modules/suppliers/adapters/mock-supplier.adapter';
import { ShenzhenKefeiAdapter } from '@/modules/suppliers/adapters/shenzhen-kefei.adapter';
import type { MockSupplierMode, SupplierAdapter } from '@/modules/suppliers/adapters/types';
import type { SupplierContract } from '@/modules/suppliers/contracts';
import { chooseSupplierCandidate } from '@/modules/suppliers/supplier-routing';
import type { SuppliersRepository as Repository } from '@/modules/suppliers/suppliers.repository';
import type {
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

export class SuppliersService implements SupplierContract {
  constructor(
    private readonly repository: Repository,
    private readonly orderContract: OrderContract,
    private readonly workerContract: WorkerContract,
  ) {}

  async listSuppliers() {
    return this.repository.listSuppliers();
  }

  async getSupplierBalance(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    const adapter = await this.getAdapter(supplier.supplierCode);

    if (!adapter.getBalance) {
      throw badRequest('当前供应商不支持余额查询');
    }

    return adapter.getBalance();
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

    const result = await adapter.syncCatalog();
    const synced = await this.syncFullCatalog({
      supplierCode: supplier.supplierCode,
      items: result.items,
    });

    return {
      supplierCode: supplier.supplierCode,
      syncedProducts: synced.syncedProducts,
    };
  }

  async listSyncLogs(input: { supplierId: string }) {
    const supplier = await this.repository.findSupplierById(input.supplierId);

    if (!supplier) {
      throw notFound('供应商不存在');
    }

    return this.repository.listSyncLogsBySupplierId(input.supplierId);
  }

  async createSupplier(input: {
    supplierCode: string;
    supplierName: string;
    protocolType: string;
  }) {
    return this.repository.createSupplier(input);
  }

  async upsertConfig(input: {
    supplierId: string;
    configJson: Record<string, unknown>;
    credential: string;
    callbackSecret: string;
    timeoutMs: number;
  }) {
    await this.repository.upsertConfig(input);
  }

  async syncFullCatalog(input: {
    supplierCode: string;
    items: SupplierCatalogItem[];
  }): Promise<{ syncedProducts: string[] }> {
    const supplier = await this.requireSupplierByCode(input.supplierCode);

    try {
      const syncedProducts: string[] = [];

      for (const item of input.items) {
        const product = await this.repository.upsertRechargeProduct(item);

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
    const submitResult = await adapter.submitOrder({
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
    });

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
    const queryResult = await adapter.queryOrder({
      supplierOrderNo: payload.supplierOrderNo,
      attemptIndex: payload.attemptIndex,
      orderNo: payload.orderNo,
    });

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

  async handleSupplierQueryJob(payload: Record<string, unknown>) {
    await this.queryOrder({
      orderNo: String(payload.orderNo ?? ''),
      supplierOrderNo: String(payload.supplierOrderNo ?? ''),
      attemptIndex: Number(payload.attemptIndex ?? 0),
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
    })) as Array<{
      supplierId: string;
      supplierProductCode: string;
      priority: number;
      costPrice: number;
      [key: string]: unknown;
    }>;
    const primarySupplier = chooseSupplierCandidate(normalizedCandidates);

    if (!primarySupplier) {
      throw badRequest('订单缺少供应商候选映射');
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
