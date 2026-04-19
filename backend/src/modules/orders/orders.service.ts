import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import { lookupMobileSegment } from '@/lib/mobile-lookup';
import { toAmountFen, toIsoDateTime } from '@/lib/utils';
import type { ChannelContract } from '@/modules/channels/contracts';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { LedgerContract } from '@/modules/ledger/contracts';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import { notificationWorkerMaxAttempts } from '@/modules/notifications/retry-policy';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrdersRepository } from '@/modules/orders/orders.repository';
import type {
  OpenOrderEventRecord,
  OpenOrderRecord,
  OrderEventListFilters,
  OrderGroupRecord,
  OrderEventRecord,
  OrderListFilters,
  OrderPieceRecord,
  OrderRecord,
} from '@/modules/orders/orders.types';
import type { ProductContract } from '@/modules/products/contracts';
import type { RechargeProductType } from '@/modules/products/products.types';
import type { RiskContract } from '@/modules/risk/contracts';
import type { WorkerContract } from '@/modules/worker/contracts';

function isUniqueConstraintViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

interface SplitCandidate {
  productId: string;
  productCode: string | null;
  productName: string;
  carrierCode: string;
  province: string;
  faceValue: number;
  productType: string | null;
  salePrice: number;
  routeSupplierId: string;
  routeSupplierName: string | null;
  routeSupplierProductCode: string;
  routeCostPrice: number;
  latestSnapshotAt: string | null;
  status: string;
}

export class OrdersService implements OrderContract {
  private readonly notificationsRepository: Pick<
    NotificationsRepository,
    'findLatestTaskByOrderNo' | 'syncNextRetryAt'
  >;

  constructor(
    private readonly repository: OrdersRepository,
    private readonly channelsService: ChannelsService,
    private readonly channelContract: ChannelContract,
    private readonly productContract: ProductContract,
    private readonly riskContract: RiskContract,
    private readonly ledgerContract: LedgerContract,
    private readonly workerContract: WorkerContract,
    notificationsRepository: Pick<
      NotificationsRepository,
      'findLatestTaskByOrderNo' | 'syncNextRetryAt'
    > = new NotificationsRepository(),
  ) {
    this.notificationsRepository = notificationsRepository;
  }

  private toAdminOrderListItem(order: OrderGroupRecord) {
    return {
      orderNo: order.orderNo,
      channelOrderNo: order.channelOrderNo,
      channelId: order.channelId,
      productId: null,
      mobile: order.mobile,
      province: order.province,
      ispName: order.carrierCode,
      requestedProductType: order.requestedProductType,
      faceValueAmountFen: toAmountFen(order.faceValueTotal) ?? 0,
      saleAmountFen: toAmountFen(order.totalSalePrice) ?? 0,
      purchaseAmountFen: toAmountFen(order.totalPurchasePrice) ?? 0,
      currency: order.currency,
      mainStatus: order.mainStatus,
      supplierStatus: order.supplierStatus,
      notifyStatus: order.notifyStatus,
      refundStatus: order.refundStatus,
      monitorStatus: order.monitorStatus,
      exceptionTag: null,
      createdAt: toIsoDateTime(order.createdAt) ?? order.createdAt,
      updatedAt: toIsoDateTime(order.updatedAt) ?? order.updatedAt,
      finishedAt: toIsoDateTime(order.finishedAt),
    };
  }

  private toOrderPieceSummary(piece: OrderPieceRecord) {
    return {
      orderNo: piece.orderNo,
      supplierId: piece.supplierId,
      productId: piece.productId,
      pieceNo: piece.pieceNo,
      pieceCount: piece.pieceCount,
      supplierOrderNo: piece.supplierOrderNo,
      faceValueAmountFen: toAmountFen(piece.faceValue) ?? 0,
      saleAmountFen: toAmountFen(piece.salePrice) ?? 0,
      purchaseAmountFen: toAmountFen(piece.purchasePrice) ?? 0,
      mainStatus: piece.mainStatus,
      supplierStatus: piece.supplierStatus,
      refundStatus: piece.refundStatus,
      notifyStatus: piece.notifyStatus,
      monitorStatus: piece.monitorStatus,
      remark: piece.remark,
      exceptionTag: piece.exceptionTag,
      createdAt: toIsoDateTime(piece.createdAt) ?? piece.createdAt,
      updatedAt: toIsoDateTime(piece.updatedAt) ?? piece.updatedAt,
      finishedAt: toIsoDateTime(piece.finishedAt),
    };
  }

  private toAdminOrderEventRecord(event: OrderEventRecord) {
    return {
      id: event.id,
      orderNo: event.orderNo,
      eventType: event.eventType,
      sourceService: event.sourceService,
      sourceNo: event.sourceNo,
      beforeStatus: event.beforeStatusJson,
      afterStatus: event.afterStatusJson,
      payload: event.payloadJson,
      operator: event.operator,
      occurredAt: toIsoDateTime(event.occurredAt) ?? event.occurredAt,
    };
  }

  async listOrders(filters: OrderListFilters = {}) {
    const result = await this.repository.listOrderGroups(filters);

    return {
      items: result.items.map((item) => this.toAdminOrderListItem(item)),
      total: result.total,
    };
  }

  private async getOrderGroupByNo(orderNo: string): Promise<OrderGroupRecord> {
    const order = await this.repository.findGroupByOrderNo(orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  private async getPieceOrderByNo(orderNo: string): Promise<OrderRecord> {
    const order = await this.repository.findByOrderNo(orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  private toGroupOrderRecord(group: OrderGroupRecord, firstPiece: OrderRecord): OrderRecord {
    return {
      ...firstPiece,
      orderNo: group.orderNo,
      parentOrderNo: group.orderNo,
      channelOrderNo: group.channelOrderNo,
      channelId: group.channelId,
      mobile: group.mobile,
      province: group.province,
      ispName: group.carrierCode,
      faceValue: group.faceValueTotal,
      requestedProductType: group.requestedProductType,
      salePrice: group.totalSalePrice,
      purchasePrice: group.totalPurchasePrice,
      currency: group.currency,
      mainStatus: group.mainStatus,
      supplierStatus: group.supplierStatus,
      notifyStatus: group.notifyStatus,
      refundStatus: group.refundStatus,
      monitorStatus: group.monitorStatus,
      remark: group.failedReason,
      extJson: group.extJson,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      finishedAt: group.finishedAt,
    };
  }

  async getOrderByNo(orderNo: string): Promise<OrderRecord> {
    const group = await this.repository.findGroupByOrderNo(orderNo);

    if (group) {
      const pieces = await this.repository.listPieceOrders(group.orderNo);
      const firstPiece = pieces[0] ? await this.getPieceOrderByNo(pieces[0].orderNo) : null;

      if (!firstPiece) {
        throw notFound('订单不存在');
      }

      return this.toGroupOrderRecord(group, firstPiece);
    }

    return this.getPieceOrderByNo(orderNo);
  }

  async getAdminOrderDetail(orderNo: string) {
    const order = await this.getOrderGroupByNo(orderNo);
    const pieces = await this.repository.listPieceOrders(order.orderNo);
    const firstPiece = pieces[0] ? await this.getPieceOrderByNo(pieces[0].orderNo) : null;
    const latestTask = await this.notificationsRepository.findLatestTaskByOrderNo(orderNo);
    const callbackSnapshot = firstPiece?.callbackSnapshotJson.callbackConfig as
      | Record<string, unknown>
      | undefined;
    const riskSnapshot = (firstPiece?.riskSnapshotJson ?? {}) as Record<string, unknown>;
    const grossProfitAmountFen =
      toAmountFen(Number(order.totalSalePrice) - Number(order.totalPurchasePrice)) ?? 0;

    return {
      basicInfo: {
        orderNo: order.orderNo,
        channelOrderNo: order.channelOrderNo,
        channelId: order.channelId,
        mobile: order.mobile,
        province: order.province,
        ispName: order.carrierCode,
        productId: firstPiece?.matchedProductId ?? null,
        requestedProductType: order.requestedProductType,
        faceValueAmountFen: toAmountFen(order.faceValueTotal) ?? 0,
        createdAt: toIsoDateTime(order.createdAt) ?? order.createdAt,
        updatedAt: toIsoDateTime(order.updatedAt) ?? order.updatedAt,
        finishedAt: toIsoDateTime(order.finishedAt),
      },
      paymentInfo: {
        currency: order.currency,
        saleAmountFen: toAmountFen(order.totalSalePrice) ?? 0,
        purchaseAmountFen: toAmountFen(order.totalPurchasePrice) ?? 0,
        grossProfitAmountFen,
        paymentStatus: 'PAID',
        refundStatus: order.refundStatus,
      },
      fulfillmentInfo: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
        monitorStatus: order.monitorStatus,
        warningDeadlineAt: firstPiece ? toIsoDateTime(firstPiece.warningDeadlineAt) : null,
        expireDeadlineAt: firstPiece ? toIsoDateTime(firstPiece.expireDeadlineAt) : null,
        exceptionTag: null,
        remark: order.failedReason,
      },
      notificationInfo: {
        notifyStatus: order.notifyStatus,
        latestTaskNo: latestTask?.taskNo ?? null,
        latestTaskStatus: latestTask?.status ?? null,
        latestTaskLastError: latestTask?.lastError ?? null,
        callbackUrl:
          typeof callbackSnapshot?.callbackUrl === 'string' ? callbackSnapshot.callbackUrl : null,
        retryEnabled:
          typeof callbackSnapshot?.retryEnabled === 'boolean'
            ? callbackSnapshot.retryEnabled
            : null,
        timeoutSeconds:
          typeof callbackSnapshot?.timeoutSeconds === 'number'
            ? callbackSnapshot.timeoutSeconds
            : null,
      },
      riskInfo: {
        decision: typeof riskSnapshot.decision === 'string' ? riskSnapshot.decision : null,
        reason: typeof riskSnapshot.reason === 'string' ? riskSnapshot.reason : null,
        hitRules: Array.isArray(riskSnapshot.hitRules)
          ? riskSnapshot.hitRules.filter((item): item is string => typeof item === 'string')
          : [],
        snapshot: riskSnapshot,
      },
      ledgerInfo: {
        currency: order.currency,
        saleAmountFen: toAmountFen(order.totalSalePrice) ?? 0,
        purchaseAmountFen: toAmountFen(order.totalPurchasePrice) ?? 0,
        grossProfitAmountFen,
        refundStatus: order.refundStatus,
      },
      businessSnapshot: {
        channel: firstPiece?.channelSnapshotJson ?? {},
        product: {
          splitResult: order.splitResultJson,
          pieces: pieces.map((piece) => this.toOrderPieceSummary(piece)),
        },
        callback: firstPiece?.callbackSnapshotJson ?? {},
        supplierRoute: firstPiece?.supplierRouteSnapshotJson ?? {},
        risk: firstPiece?.riskSnapshotJson ?? {},
        ext: order.extJson,
      },
    };
  }

  private async getOrderGroupByNoForChannel(
    channelId: string,
    orderNo: string,
  ): Promise<OrderGroupRecord> {
    const order = await this.repository.findGroupByOrderNoAndChannel(channelId, orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  async getSupplierExecutionContext(orderNo: string) {
    const piece = await this.repository.findByOrderNo(orderNo);

    if (piece) {
      return piece;
    }

    const group = await this.repository.findGroupByOrderNo(orderNo);

    if (!group) {
      throw notFound('订单不存在');
    }

    const pieces = await this.repository.listPieceOrders(group.orderNo);
    const firstPiece = pieces[0] ? await this.getPieceOrderByNo(pieces[0].orderNo) : null;

    if (!firstPiece) {
      throw notFound('订单子单不存在');
    }

    return firstPiece;
  }

  async getNotificationContext(orderNo: string) {
    const group = await this.getOrderGroupByNo(orderNo);
    const pieces = await this.repository.listPieceOrders(group.orderNo);
    const firstPiece = pieces[0] ? await this.getPieceOrderByNo(pieces[0].orderNo) : null;

    if (firstPiece) {
      return this.toGroupOrderRecord(group, firstPiece);
    }

    throw notFound('订单子单不存在');
  }

  async getLedgerContext(orderNo: string) {
    return this.getNotificationContext(orderNo);
  }

  async listEvents(orderNo: string, filters: OrderEventListFilters = {}) {
    const result = await this.repository.listGroupEvents(orderNo, filters);

    return {
      items: result.items.map((item) => this.toAdminOrderEventRecord(item)),
      total: result.total,
    };
  }

  async listEventsForChannel(channelId: string, orderNo: string) {
    await this.getOrderGroupByNoForChannel(channelId, orderNo);
    const result = await this.repository.listGroupEvents(orderNo, {
      pageNum: 1,
      pageSize: 200,
      sortBy: 'occurredAt',
      sortOrder: 'asc',
    });
    return result.items;
  }

  toOpenOrderRecord(order: OrderGroupRecord, pieces: OrderPieceRecord[]): OpenOrderRecord {
    return {
      orderNo: order.orderNo,
      channelOrderNo: order.channelOrderNo,
      mobile: order.mobile,
      province: order.province,
      ispName: order.carrierCode,
      faceValue: order.faceValueTotal,
      matchedProductId: pieces[0]?.productId ?? null,
      salePrice: order.totalSalePrice,
      currency: order.currency,
      mainStatus: order.mainStatus,
      supplierStatus: order.supplierStatus,
      notifyStatus: order.notifyStatus,
      refundStatus: order.refundStatus,
      requestedProductType: order.requestedProductType,
      extJson: order.extJson,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      finishedAt: order.finishedAt,
    };
  }

  toOpenOrderEventRecord(event: OrderEventRecord): OpenOrderEventRecord {
    return {
      eventType: event.eventType,
      sourceNo: event.sourceNo,
      beforeStatusJson: event.beforeStatusJson,
      afterStatusJson: event.afterStatusJson,
      occurredAt: event.occurredAt,
    };
  }

  async getOpenOrderByNoForChannel(channelId: string, orderNo: string): Promise<OpenOrderRecord> {
    const group = await this.getOrderGroupByNoForChannel(channelId, orderNo);
    const pieces = await this.repository.listPieceOrders(group.orderNo);
    return this.toOpenOrderRecord(group, pieces);
  }

  async listOpenEventsForChannel(
    channelId: string,
    orderNo: string,
  ): Promise<OpenOrderEventRecord[]> {
    const events = await this.listEventsForChannel(channelId, orderNo);
    return events.map((event) => this.toOpenOrderEventRecord(event));
  }

  async previewSplit(input: {
    channelId: string;
    mobile: string;
    faceValue: number;
    productType?: RechargeProductType;
  }) {
    try {
      const plan = await this.resolveSplitPlan({
        channelId: input.channelId,
        mobile: input.mobile,
        faceValue: input.faceValue,
        productType: input.productType ?? 'MIXED',
      });

      return {
        matched: true,
        unmatchedReason: null,
        usedSplit: plan.usedSplit,
        supplierId: plan.supplierId ?? plan.pieces[0]?.routeSupplierId ?? null,
        mobile: plan.mobileContext.mobile,
        province: plan.mobileContext.province,
        ispName: plan.mobileContext.ispName,
        pieces: plan.pieces.map((piece) => ({
          productId: piece.productId,
          productName: piece.productName,
          supplierId: piece.routeSupplierId,
          supplierName: piece.routeSupplierName,
          faceValueAmountFen: toAmountFen(piece.faceValue) ?? 0,
          saleAmountFen: toAmountFen(piece.salePrice) ?? 0,
          purchaseAmountFen: toAmountFen(piece.routeCostPrice) ?? 0,
        })),
      };
    } catch (error) {
      return {
        matched: false,
        unmatchedReason: error instanceof Error ? error.message : '拆单预览失败',
        usedSplit: false,
        supplierId: null,
        mobile: input.mobile,
        province: null,
        ispName: null,
        pieces: [],
      };
    }
  }

  async listOpenOrders(input: {
    channelId: string;
    pageNum: number;
    pageSize: number;
    orderNo?: string;
    channelOrderNo?: string;
    mobile?: string;
    mainStatus?: string;
    supplierStatus?: string;
    refundStatus?: string;
    startTime?: string | null;
    endTime?: string | null;
  }) {
    const result = await this.repository.listOrderGroups({
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      channelId: input.channelId,
      orderNo: input.orderNo,
      channelOrderNo: input.channelOrderNo,
      mobile: input.mobile,
      mainStatus: input.mainStatus,
      supplierStatus: input.supplierStatus,
      refundStatus: input.refundStatus,
      startTime: input.startTime,
      endTime: input.endTime,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    return {
      items: result.items.map((item) => this.toOpenOrderRecord(item, [])),
      total: result.total,
    };
  }

  async refreshOrderStatus(orderNo: string) {
    const group = await this.getOrderGroupByNo(orderNo);
    const pieces = await this.repository.listPieceOrders(orderNo);
    let refreshedPieces = 0;

    for (const piece of pieces) {
      if (
        piece.supplierOrderNo &&
        !['SUCCESS', 'REFUNDED', 'CLOSED'].includes(piece.mainStatus) &&
        piece.supplierStatus !== 'FAIL'
      ) {
        refreshedPieces += 1;
        await this.workerContract.enqueue({
          jobType: 'supplier.query',
          businessKey: `${piece.orderNo}:${piece.supplierOrderNo}:manual-refresh`,
          payload: {
            orderNo: piece.orderNo,
            supplierOrderNo: piece.supplierOrderNo,
            attemptIndex: 1,
          },
        });
      }
    }

    return {
      orderNo: group.orderNo,
      refreshedPieces,
    };
  }

  async retryRecharge(orderNo: string) {
    const group = await this.getOrderGroupByNo(orderNo);
    const pieces = await this.repository.listPieceOrders(orderNo);
    let retriedPieces = 0;

    for (const piece of pieces) {
      if (piece.mainStatus === 'SUCCESS') {
        continue;
      }

      retriedPieces += 1;
      await this.workerContract.enqueue({
        jobType: 'supplier.submit',
        businessKey: `${piece.orderNo}:manual-retry`,
        payload: {
          orderNo: piece.orderNo,
        },
      });
    }

    return {
      orderNo: group.orderNo,
      retriedPieces,
    };
  }

  async manualUpdateStatus(input: {
    orderNo: string;
    mainStatus: string;
    supplierStatus?: string;
    refundStatus?: string;
    remark?: string;
    requestId: string;
  }) {
    const group = await this.getOrderGroupByNo(input.orderNo);
    const pieces = await this.repository.listPieceOrders(input.orderNo);

    for (const piece of pieces) {
      await this.repository.updateStatuses(piece.orderNo, {
        mainStatus: input.mainStatus as OrderRecord['mainStatus'],
        supplierStatus:
          (input.supplierStatus as OrderRecord['supplierStatus']) ?? piece.supplierStatus,
        refundStatus: (input.refundStatus as OrderRecord['refundStatus']) ?? piece.refundStatus,
        remark: input.remark ?? piece.remark,
        finishedAt: ['SUCCESS', 'REFUNDED', 'CLOSED', 'FAIL'].includes(input.mainStatus),
      });
    }

    await this.repository.updateGroupStatuses(input.orderNo, {
      mainStatus: input.mainStatus as OrderGroupRecord['mainStatus'],
      supplierStatus:
        (input.supplierStatus as OrderGroupRecord['supplierStatus']) ?? group.supplierStatus,
      refundStatus: (input.refundStatus as OrderGroupRecord['refundStatus']) ?? group.refundStatus,
      finishedAt: ['SUCCESS', 'REFUNDED', 'CLOSED', 'FAIL'].includes(input.mainStatus),
    });

    await this.repository.addEvent({
      orderNo: input.orderNo,
      parentOrderNo: input.orderNo,
      eventType: 'OrderManualStatusUpdated',
      sourceService: 'orders',
      sourceNo: null,
      beforeStatusJson: {
        mainStatus: group.mainStatus,
        supplierStatus: group.supplierStatus,
        refundStatus: group.refundStatus,
      },
      afterStatusJson: {
        mainStatus: input.mainStatus,
        supplierStatus: input.supplierStatus ?? group.supplierStatus,
        refundStatus: input.refundStatus ?? group.refundStatus,
      },
      payloadJson: {
        remark: input.remark ?? null,
      },
      idempotencyKey: `manual-status:${input.orderNo}:${input.requestId}`,
      operator: 'ADMIN',
      requestId: input.requestId,
    });
  }

  async listCustomers(channelId: string) {
    const result = await this.repository.listOrderGroups({
      pageNum: 1,
      pageSize: 1000,
      channelId,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    const customers = new Map<
      string,
      {
        mobile: string;
        totalOrders: number;
        totalSalePrice: number;
        lastOrderAt: string;
      }
    >();

    for (const item of result.items) {
      const existing = customers.get(item.mobile);

      if (existing) {
        existing.totalOrders += 1;
        existing.totalSalePrice += item.totalSalePrice;
        if (new Date(item.createdAt).getTime() > new Date(existing.lastOrderAt).getTime()) {
          existing.lastOrderAt = item.createdAt;
        }
        continue;
      }

      customers.set(item.mobile, {
        mobile: item.mobile,
        totalOrders: 1,
        totalSalePrice: item.totalSalePrice,
        lastOrderAt: item.createdAt,
      });
    }

    return Array.from(customers.values()).map((item) => ({
      mobile: item.mobile,
      totalOrders: item.totalOrders,
      totalSaleAmountFen: toAmountFen(item.totalSalePrice) ?? 0,
      lastOrderAt: toIsoDateTime(item.lastOrderAt) ?? item.lastOrderAt,
    }));
  }

  async getCustomerDetail(channelId: string, mobile: string) {
    const orders = await this.listOpenOrders({
      channelId,
      pageNum: 1,
      pageSize: 200,
      mobile,
    });

    return {
      mobile,
      orders: orders.items,
      totalOrders: orders.total,
    };
  }

  private async writeArtifactFile(
    prefix: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ) {
    const exportDir = join(process.cwd(), 'var', 'exports');
    await mkdir(exportDir, { recursive: true });
    const fileName = `${prefix}-${Date.now()}.xlsx`;
    const filePath = join(exportDir, fileName);
    const content = [headers.join('\t'), ...rows.map((row) => row.map((cell) => cell ?? '').join('\t'))].join('\n');
    await Bun.write(filePath, content);

    return {
      fileName,
      filePath,
      downloadUrl: `/downloads/${fileName}`,
    };
  }

  private async createBatchJob(
    channelId: string,
    jobType: string,
    businessKey: string,
    items: Array<Record<string, unknown>>,
    handler: (item: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) {
    const job = (await this.workerContract.enqueue({
      jobType,
      businessKey,
      payload: {
        channelId,
        itemCount: items.length,
      },
      maxAttempts: 1,
    })) as { id: string };

    const receiptRows: Array<Array<string | number | null>> = [];

    for (const [index, item] of items.entries()) {
      try {
        const result = await handler(item);
        await this.workerContract.upsertJobItem({
          jobId: job.id,
          itemNo: String(index + 1),
          status: 'SUCCESS',
          payloadJson: item,
          resultJson: result,
        });
        receiptRows.push([index + 1, 'SUCCESS', JSON.stringify(result)]);
      } catch (error) {
        const message = error instanceof Error ? error.message : '处理失败';
        await this.workerContract.upsertJobItem({
          jobId: job.id,
          itemNo: String(index + 1),
          status: 'FAIL',
          payloadJson: item,
          resultJson: {},
          errorMessage: message,
        });
        receiptRows.push([index + 1, 'FAIL', message]);
      }
    }

    const artifact = await this.writeArtifactFile(jobType.replaceAll('.', '-'), ['itemNo', 'status', 'result'], receiptRows);
    await this.workerContract.createArtifact({
      jobId: job.id,
      artifactType: 'RESULT',
      fileName: artifact.fileName,
      filePath: artifact.filePath,
      downloadUrl: artifact.downloadUrl,
    });
    await this.workerContract.completeJob(job.id);

    return this.workerContract.getById(job.id);
  }

  async createBatchOrders(input: {
    channelId: string;
    orders: Array<Record<string, unknown>>;
    requestId: string;
    clientIp: string;
  }) {
    return this.createBatchJob(
      input.channelId,
      'order.batch.create',
      `${input.channelId}:${input.requestId}:batch`,
      input.orders,
      async (item) => {
        const created = await this.createOrder({
          channelId: input.channelId,
          channelOrderNo: String(item.channelOrderNo ?? ''),
          mobile: String(item.mobile ?? ''),
          faceValue: Number(item.faceValue ?? 0),
          productType:
            item.productType === 'FAST' || item.productType === 'MIXED'
              ? item.productType
              : undefined,
          extJson:
            typeof item.ext === 'object' && item.ext !== null
              ? (item.ext as Record<string, unknown>)
              : {},
          requestId: input.requestId,
          clientIp: input.clientIp,
        });

        return {
          orderNo: created.orderNo,
        };
      },
    );
  }

  async createBatchImportJob(input: {
    channelId: string;
    content: string;
    requestId: string;
    clientIp: string;
  }) {
    const lines = input.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const [, ...dataLines] = lines;
    const items = dataLines.map((line) => {
      const [channelOrderNo = '', mobile = '', faceValue = '', productType = ''] = line.split(',');

      return {
        channelOrderNo,
        mobile,
        faceValue: Number(faceValue),
        productType,
      };
    });

    return this.createBatchOrders({
      channelId: input.channelId,
      orders: items,
      requestId: input.requestId,
      clientIp: input.clientIp,
    });
  }

  async exportOrders(channelId: string) {
    const orders = await this.repository.listOrderGroups({
      pageNum: 1,
      pageSize: 1000,
      channelId,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    return this.createBatchJob(
      channelId,
      'order.export.orders',
      `${channelId}:orders-export:${Date.now()}`,
      orders.items.map((item) => ({
        orderNo: item.orderNo,
        channelOrderNo: item.channelOrderNo,
        mobile: item.mobile,
        mainStatus: item.mainStatus,
      })),
      async (item) => item,
    );
  }

  async exportCustomers(channelId: string) {
    const customers = await this.listCustomers(channelId);

    return this.createBatchJob(
      channelId,
      'order.export.customers',
      `${channelId}:customers-export:${Date.now()}`,
      customers.map((item) => item as Record<string, unknown>),
      async (item) => item,
    );
  }

  async exportLogs(channelId: string) {
    const orders = await this.repository.listOrderGroups({
      pageNum: 1,
      pageSize: 1000,
      channelId,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    return this.createBatchJob(
      channelId,
      'order.export.logs',
      `${channelId}:logs-export:${Date.now()}`,
      orders.items.map((item) => ({
        orderNo: item.orderNo,
        mainStatus: item.mainStatus,
        supplierStatus: item.supplierStatus,
        refundStatus: item.refundStatus,
        createdAt: item.createdAt,
      })),
      async (item) => item,
    );
  }

  async getJobById(jobId: string) {
    return this.workerContract.getById(jobId);
  }

  async getJobItems(jobId: string) {
    return this.workerContract.listJobItems(jobId);
  }

  async getJobArtifacts(jobId: string) {
    return this.workerContract.listJobArtifacts(jobId);
  }

  getBatchTemplate() {
    return {
      fileName: 'batch-template.xlsx',
      content: 'channelOrderNo,mobile,faceValue,productType\nexample-001,13800138000,100,MIXED\n',
    };
  }

  private toSplitCandidateList(
    products: Awaited<ReturnType<ChannelsService['listChannelProducts']>>,
    carrierCode: string,
    province: string,
    productType: RechargeProductType,
  ): SplitCandidate[] {
    return products
      .filter((item) => {
        if (!item.authorized || item.salePrice === null) {
          return false;
        }

        if (!item.routeSupplierId || !item.routeSupplierProductCode) {
          return false;
        }

        if (item.routeCostPrice === null || item.routeCostPrice === undefined) {
          return false;
        }

        if (item.status !== 'ACTIVE') {
          return false;
        }

        if (item.carrierCode !== carrierCode) {
          return false;
        }

        if (item.productType && item.productType !== productType) {
          return false;
        }

        return item.province === province || item.province === '全国';
      })
      .map((item) => ({
        productId: item.productId,
        productCode: item.productCode ?? null,
        productName: item.productName,
        carrierCode: item.carrierCode,
        province: item.province,
        faceValue: item.faceValue,
        productType: item.productType ?? productType,
        salePrice: Number(item.salePrice),
        routeSupplierId: item.routeSupplierId as string,
        routeSupplierName: item.routeSupplierName ?? null,
        routeSupplierProductCode: item.routeSupplierProductCode as string,
        routeCostPrice: Number(item.routeCostPrice),
        latestSnapshotAt: item.latestSnapshotAt,
        status: item.status,
      }));
  }

  private pickPreferredCandidate(
    candidates: SplitCandidate[],
    province: string,
  ): SplitCandidate | null {
    const sorted = [...candidates].sort((left, right) => {
      const provinceScoreLeft = left.province === province ? 0 : 1;
      const provinceScoreRight = right.province === province ? 0 : 1;

      if (provinceScoreLeft !== provinceScoreRight) {
        return provinceScoreLeft - provinceScoreRight;
      }

      if (left.salePrice !== right.salePrice) {
        return left.salePrice - right.salePrice;
      }

      if (left.routeCostPrice !== right.routeCostPrice) {
        return left.routeCostPrice - right.routeCostPrice;
      }

      return left.productId.localeCompare(right.productId);
    });

    return sorted[0] ?? null;
  }

  private findSplitCombination(
    totalFaceValue: number,
    candidateByFaceValue: Map<number, SplitCandidate>,
    maxPieces: number,
    preferMaxSingleFaceValue: boolean,
  ): SplitCandidate[] | null {
    const faceValues = Array.from(candidateByFaceValue.keys()).sort((left, right) =>
      preferMaxSingleFaceValue ? right - left : left - right,
    );
    const path: SplitCandidate[] = [];

    const dfs = (remaining: number): boolean => {
      if (remaining === 0) {
        return true;
      }

      if (path.length >= maxPieces) {
        return false;
      }

      for (const faceValue of faceValues) {
        if (faceValue > remaining) {
          continue;
        }

        const candidate = candidateByFaceValue.get(faceValue);

        if (!candidate) {
          continue;
        }

        path.push(candidate);

        if (dfs(remaining - faceValue)) {
          return true;
        }

        path.pop();
      }

      return false;
    };

    return dfs(totalFaceValue) ? [...path] : null;
  }

  private async resolveSplitPlan(input: {
    channelId: string;
    mobile: string;
    faceValue: number;
    productType: RechargeProductType;
  }) {
    const mobileContext = await lookupMobileSegment(input.mobile);
    const splitPolicy = await this.channelsService.getSplitPolicy(input.channelId);
    const carrierCode = splitPolicy.carrierOverride ?? mobileContext.ispName;
    const province = splitPolicy.provinceOverride ?? mobileContext.province;
    const channelProducts = await this.channelsService.listChannelProducts(input.channelId, {
      carrierCode,
      productType: input.productType,
      status: 'ACTIVE',
    });
    const candidates = this.toSplitCandidateList(
      channelProducts,
      carrierCode,
      province,
      input.productType,
    );

    if (candidates.length === 0) {
      throw notFound('未匹配到渠道已授权且可售的充值商品');
    }

    const exact = this.pickPreferredCandidate(
      candidates.filter((item) => item.faceValue === input.faceValue),
      province,
    );

    if (exact) {
      return {
        mobileContext: {
          mobile: mobileContext.mobile,
          province,
          ispName: carrierCode,
        },
        pieces: [exact],
        usedSplit: false,
        splitPolicy,
      };
    }

    if (!splitPolicy.enabled) {
      throw badRequest('渠道拆单未开启，且未匹配到精确面值商品');
    }

    if (splitPolicy.maxSplitPieces <= 1) {
      throw badRequest('渠道拆单片数上限不足，无法完成拆单');
    }

    const allowedFaceValues = splitPolicy.allowedFaceValues.filter((value) => value > 0);

    if (allowedFaceValues.length === 0) {
      throw badRequest('渠道拆单面值配置为空');
    }

    const supplierBuckets = new Map<string, SplitCandidate[]>();

    for (const candidate of candidates) {
      if (!allowedFaceValues.includes(candidate.faceValue)) {
        continue;
      }

      const bucket = supplierBuckets.get(candidate.routeSupplierId) ?? [];
      bucket.push(candidate);
      supplierBuckets.set(candidate.routeSupplierId, bucket);
    }

    for (const [supplierId, bucket] of supplierBuckets.entries()) {
      const candidateByFaceValue = new Map<number, SplitCandidate>();

      for (const faceValue of allowedFaceValues) {
        const picked = this.pickPreferredCandidate(
          bucket.filter((item) => item.faceValue === faceValue),
          province,
        );

        if (picked) {
          candidateByFaceValue.set(faceValue, picked);
        }
      }

      if (candidateByFaceValue.size === 0) {
        continue;
      }

      const pieces = this.findSplitCombination(
        input.faceValue,
        candidateByFaceValue,
        splitPolicy.maxSplitPieces,
        splitPolicy.preferMaxSingleFaceValue,
      );

      if (pieces) {
        return {
          mobileContext: {
            mobile: mobileContext.mobile,
            province,
            ispName: carrierCode,
          },
          pieces,
          usedSplit: pieces.length > 1,
          supplierId,
          splitPolicy,
        };
      }
    }

    throw badRequest('当前渠道与单一供应商下不存在可精确凑额的拆单组合');
  }

  async createOrder(input: {
    channelId: string;
    channelOrderNo: string;
    mobile: string;
    faceValue: number;
    productType?: RechargeProductType;
    extJson?: Record<string, unknown>;
    requestId: string;
    clientIp: string;
  }) {
    return this.repository.withCreateOrderLock(input.channelId, input.channelOrderNo, async () => {
      const existing = await this.repository.findGroupByChannelOrder(
        input.channelId,
        input.channelOrderNo,
      );

      if (existing) {
        return existing;
      }
      const requestedProductType = input.productType ?? 'MIXED';
      const routingPlan = await this.resolveSplitPlan({
        channelId: input.channelId,
        mobile: input.mobile,
        faceValue: input.faceValue,
        productType: requestedProductType,
      });
      const primaryPiece = routingPlan.pieces[0];

      if (!primaryPiece) {
        throw badRequest('未生成有效的履约拆单结果');
      }

      const policy = await this.channelContract.getOrderPolicy({
        channelId: input.channelId,
        productId: primaryPiece.productId,
        orderAmount: input.faceValue,
      });

      const totalSalePrice = routingPlan.pieces.reduce((sum, piece) => sum + piece.salePrice, 0);
      const totalPurchasePrice = routingPlan.pieces.reduce(
        (sum, piece) => sum + piece.routeCostPrice,
        0,
      );

      if (totalSalePrice < totalPurchasePrice) {
        throw badRequest('渠道销售总价不得低于采购总价');
      }

      await this.ledgerContract.ensureBalanceSufficient({
        channelId: input.channelId,
        amount: totalSalePrice,
      });

      const riskDecision = await this.riskContract.preCheck({
        channelId: input.channelId,
        amount: totalSalePrice,
        ip: input.clientIp,
        mobile: routingPlan.mobileContext.mobile,
      });

      if (riskDecision.decision !== 'PASS') {
        throw forbidden(riskDecision.reason);
      }

      const now = Date.now();
      const isFast = requestedProductType === 'FAST';
      const warningDeadlineAt = new Date(now + (isFast ? 10 : 150) * 60 * 1000);
      const expireDeadlineAt = new Date(now + (isFast ? 60 : 180) * 60 * 1000);

      const group = await this.repository.createOrderGroup({
        channelOrderNo: input.channelOrderNo,
        channelId: input.channelId,
        mobile: routingPlan.mobileContext.mobile,
        carrierCode: routingPlan.mobileContext.ispName,
        province: routingPlan.mobileContext.province,
        faceValueTotal: input.faceValue,
        requestedProductType,
        totalSalePrice,
        totalPurchasePrice,
        mainStatus: 'CREATED',
        supplierStatus: 'WAIT_SUBMIT',
        notifyStatus: 'PENDING',
        refundStatus: 'NONE',
        monitorStatus: 'NORMAL',
        callbackUrl: policy.callbackConfig.callbackUrl,
        splitResultJson: {
          usedSplit: routingPlan.usedSplit,
          pieceCount: routingPlan.pieces.length,
          pieces: routingPlan.pieces.map((piece) => ({
            productId: piece.productId,
            productCode: piece.productCode,
            productName: piece.productName,
            faceValue: piece.faceValue,
            salePrice: piece.salePrice,
            purchasePrice: piece.routeCostPrice,
            supplierId: piece.routeSupplierId,
            supplierName: piece.routeSupplierName,
          })),
        },
        extJson: input.extJson ?? {},
        requestId: input.requestId,
      });

      const pieceCount = routingPlan.pieces.length;

      const children: OrderRecord[] = [];

      for (const [index, piece] of routingPlan.pieces.entries()) {
        const child = await this.repository.createOrder({
          orderNo: index === 0 ? group.orderNo : undefined,
          orderGroupId: group.id,
          parentOrderNo: group.orderNo,
          channelOrderNo: input.channelOrderNo,
          channelId: input.channelId,
          parentChannelId: null,
          supplierId: piece.routeSupplierId,
          mobile: routingPlan.mobileContext.mobile,
          province: routingPlan.mobileContext.province,
          ispName: routingPlan.mobileContext.ispName,
          faceValue: piece.faceValue,
          requestedProductType,
          matchedProductId: piece.productId,
          salePrice: piece.salePrice,
          purchasePrice: piece.routeCostPrice,
          pieceNo: index + 1,
          pieceCount,
          mainStatus: 'CREATED',
          supplierStatus: 'WAIT_SUBMIT',
          notifyStatus: 'PENDING',
          refundStatus: 'NONE',
          monitorStatus: 'NORMAL',
          warningDeadlineAt,
          expireDeadlineAt,
          channelSnapshotJson: {
            channel: policy.channel,
            splitPolicy: routingPlan.splitPolicy,
          },
          productSnapshotJson: {
            product: piece,
          },
          callbackSnapshotJson: {
            callbackConfig: policy.callbackConfig,
          },
          supplierRouteSnapshotJson: {
            supplierCandidates: [
              {
                supplierId: piece.routeSupplierId,
                supplierProductCode: piece.routeSupplierProductCode,
                costPrice: piece.routeCostPrice,
                routeType: 'PRIMARY',
                priority: 1,
                salesStatus: 'ON_SALE',
                inventoryQuantity: 1,
                dynamicUpdatedAt: piece.latestSnapshotAt ?? new Date().toISOString(),
                status: piece.status,
              },
            ],
          },
          riskSnapshotJson: {
            ...riskDecision,
          },
          extJson: {
            ...(input.extJson ?? {}),
            parentOrderNo: group.orderNo,
          },
          requestId: input.requestId,
        });

        children.push(child);
      }

      await this.repository.addEvent({
        orderNo: group.orderNo,
        parentOrderNo: group.orderNo,
        eventType: 'OrderCreated',
        sourceService: 'orders',
        sourceNo: null,
        beforeStatusJson: {},
        afterStatusJson: {
          mainStatus: group.mainStatus,
          supplierStatus: group.supplierStatus,
          notifyStatus: group.notifyStatus,
          refundStatus: group.refundStatus,
        },
        payloadJson: {
          mobile: group.mobile,
          faceValue: group.faceValueTotal,
          requestedProductType: group.requestedProductType,
          usedSplit: routingPlan.usedSplit,
          pieceOrders: children.map((child) => child.orderNo),
          riskDecision,
        },
        idempotencyKey: `${input.channelId}:${input.channelOrderNo}`,
        operator: 'SYSTEM',
        requestId: input.requestId,
      });

      await this.ledgerContract.debitOrderAmount({
        channelId: group.channelId,
        orderNo: group.orderNo,
        amount: group.totalSalePrice,
      });

      for (const child of children) {
        await this.workerContract.enqueue({
          jobType: 'supplier.submit',
          businessKey: child.orderNo,
          payload: {
            orderNo: child.orderNo,
          },
        });
      }

      return this.getOrderGroupByNo(group.orderNo);
    });
  }

  private async compensateInitialSubmitEnqueueFailure(order: OrderRecord, reason: string) {
    const currentOrder = await this.getSupplierExecutionContext(order.orderNo);

    if (currentOrder.mainStatus === 'REFUNDED') {
      return;
    }

    if (
      currentOrder.mainStatus !== 'CREATED' ||
      currentOrder.supplierStatus !== 'WAIT_SUBMIT' ||
      currentOrder.refundStatus !== 'NONE'
    ) {
      return;
    }

    await this.repository.updateStatuses(currentOrder.orderNo, {
      mainStatus: 'REFUNDING',
      supplierStatus: 'FAIL',
      refundStatus: 'PENDING',
    });
    await this.repository.addEvent({
      orderNo: currentOrder.orderNo,
      eventType: 'SupplierSubmitEnqueueFailed',
      sourceService: 'orders',
      sourceNo: null,
      beforeStatusJson: {
        mainStatus: currentOrder.mainStatus,
        supplierStatus: currentOrder.supplierStatus,
        refundStatus: currentOrder.refundStatus,
      },
      afterStatusJson: {
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
        refundStatus: 'PENDING',
      },
      payloadJson: {
        reason,
      },
      idempotencyKey: `supplier-submit-enqueue-fail:${currentOrder.orderNo}`,
      operator: 'SYSTEM',
      requestId: currentOrder.requestId,
    });

    await this.refundPendingOrder(
      {
        ...currentOrder,
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
        refundStatus: 'PENDING',
      },
      {
        throwOnFailure: false,
      },
    );
  }

  private deriveAggregatedGroupStatuses(
    pieces: OrderPieceRecord[],
    current: OrderGroupRecord,
  ): {
    mainStatus: OrderGroupRecord['mainStatus'];
    supplierStatus: OrderGroupRecord['supplierStatus'];
    refundStatus: OrderGroupRecord['refundStatus'];
    monitorStatus: OrderGroupRecord['monitorStatus'];
    finishedAt: boolean;
  } {
    if (pieces.length === 0) {
      return {
        mainStatus: current.mainStatus,
        supplierStatus: current.supplierStatus,
        refundStatus: current.refundStatus,
        monitorStatus: current.monitorStatus,
        finishedAt: Boolean(current.finishedAt),
      };
    }

    const hasTimeoutWarning = pieces.some((piece) => piece.monitorStatus === 'TIMEOUT_WARNING');
    const hasLateCallback = pieces.some(
      (piece) => piece.monitorStatus === 'LATE_CALLBACK_EXCEPTION',
    );
    const monitorStatus = hasLateCallback
      ? 'LATE_CALLBACK_EXCEPTION'
      : hasTimeoutWarning
        ? 'TIMEOUT_WARNING'
        : 'NORMAL';

    if (pieces.every((piece) => piece.mainStatus === 'SUCCESS')) {
      return {
        mainStatus: 'SUCCESS',
        supplierStatus: 'SUCCESS',
        refundStatus: 'NONE',
        monitorStatus,
        finishedAt: true,
      };
    }

    if (pieces.every((piece) => piece.mainStatus === 'REFUNDED')) {
      return {
        mainStatus: 'REFUNDED',
        supplierStatus: 'FAIL',
        refundStatus: 'SUCCESS',
        monitorStatus,
        finishedAt: true,
      };
    }

    if (
      pieces.some((piece) => piece.refundStatus === 'PENDING' || piece.mainStatus === 'REFUNDING') ||
      pieces.some((piece) => piece.supplierStatus === 'FAIL' || piece.mainStatus === 'FAIL')
    ) {
      return {
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
        refundStatus: 'PENDING',
        monitorStatus,
        finishedAt: false,
      };
    }

    if (pieces.some((piece) => ['PROCESSING'].includes(piece.mainStatus))) {
      return {
        mainStatus: 'PROCESSING',
        supplierStatus: pieces.some((piece) => piece.supplierStatus === 'QUERYING')
          ? 'QUERYING'
          : 'ACCEPTED',
        refundStatus: 'NONE',
        monitorStatus,
        finishedAt: false,
      };
    }

    if (pieces.some((piece) => ['ACCEPTED', 'QUERYING'].includes(piece.supplierStatus))) {
      return {
        mainStatus: 'PROCESSING',
        supplierStatus: pieces.some((piece) => piece.supplierStatus === 'QUERYING')
          ? 'QUERYING'
          : 'ACCEPTED',
        refundStatus: 'NONE',
        monitorStatus,
        finishedAt: false,
      };
    }

    return {
      mainStatus: 'CREATED',
      supplierStatus: 'WAIT_SUBMIT',
      refundStatus: 'NONE',
      monitorStatus,
      finishedAt: false,
    };
  }

  private async syncOrderGroupState(parentOrderNo: string) {
    const group = await this.getOrderGroupByNo(parentOrderNo);
    const pieces = await this.repository.listPieceOrders(parentOrderNo);
    const next = this.deriveAggregatedGroupStatuses(pieces, group);

    await this.repository.updateGroupStatuses(parentOrderNo, next);

    return {
      previous: group,
      current: await this.getOrderGroupByNo(parentOrderNo),
      pieces,
    };
  }

  async retryNotification(orderNo: string) {
    await this.getOrderGroupByNo(orderNo);

    const latestTask = await this.notificationsRepository.findLatestTaskByOrderNo(orderNo);

    if (!latestTask) {
      throw badRequest('订单暂无可重试的通知任务');
    }

    const requestedRetryAt = new Date();
    const scheduledJob = await this.workerContract.schedule({
      jobType: 'notification.deliver',
      businessKey: latestTask.taskNo,
      payload: {
        taskNo: latestTask.taskNo,
      },
      nextRunAt: requestedRetryAt,
      maxAttempts: notificationWorkerMaxAttempts,
    });
    await this.notificationsRepository.syncNextRetryAt(
      latestTask.taskNo,
      new Date(scheduledJob.nextRunAt),
    );
  }

  private async scheduleRefundRetry(order: OrderRecord) {
    await this.workerContract.schedule({
      jobType: 'order.refund.retry',
      businessKey: order.orderNo,
      payload: {
        orderNo: order.orderNo,
      },
      maxAttempts: 7,
      nextRunAt: new Date(),
    });
  }

  private async refundPendingOrder(
    order: OrderRecord,
    options: {
      throwOnFailure: boolean;
    },
  ) {
    if (order.mainStatus === 'REFUNDED') {
      await this.handleRefundSucceeded({
        orderNo: order.orderNo,
        sourceService: 'ledger',
        sourceNo: null,
      });
      return;
    }

    if (order.mainStatus !== 'REFUNDING' || order.refundStatus !== 'PENDING') {
      return;
    }

    try {
      const refund = await this.ledgerContract.refundOrderAmount({
        channelId: order.channelId,
        orderNo: order.orderNo,
        amount: order.salePrice,
      });

      await this.handleRefundSucceeded({
        orderNo: order.orderNo,
        sourceService: 'ledger',
        sourceNo: refund.referenceNo,
      });
    } catch (error) {
      if (options.throwOnFailure) {
        throw error;
      }

      await this.scheduleRefundRetry(order);
    }
  }

  async handleRefundRetryJob(payload: Record<string, unknown>) {
    const orderNo = String(payload.orderNo ?? '');

    if (!orderNo) {
      throw badRequest('退款补偿任务缺少订单号');
    }

    await this.refundPendingOrder(await this.getNotificationContext(orderNo), {
      throwOnFailure: true,
    });
  }

  async closeOrder(orderNo: string, requestId: string) {
    const order = await this.getOrderGroupByNo(orderNo);
    const pieces = await this.repository.listPieceOrders(orderNo);

    if (!['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus)) {
      for (const piece of pieces) {
        await this.repository.updateStatuses(piece.orderNo, {
          mainStatus: 'REFUNDING',
          supplierStatus: 'FAIL',
          refundStatus: 'PENDING',
        });
      }

      await this.repository.updateGroupStatuses(orderNo, {
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
        refundStatus: 'PENDING',
      });
      await this.repository.addEvent({
        orderNo,
        parentOrderNo: orderNo,
        eventType: 'OrderClosed',
        sourceService: 'orders',
        beforeStatusJson: {
          mainStatus: order.mainStatus,
          supplierStatus: order.supplierStatus,
          refundStatus: order.refundStatus,
        },
        afterStatusJson: {
          mainStatus: 'REFUNDING',
          supplierStatus: 'FAIL',
          refundStatus: 'PENDING',
        },
        payloadJson: {
          closeMode: 'REFUND_REQUIRED',
        },
        idempotencyKey: `close:${orderNo}`,
        operator: 'ADMIN',
        requestId,
      });

      await this.refundPendingOrder(await this.getNotificationContext(orderNo), {
        throwOnFailure: false,
      });
      return;
    }

    await this.repository.updateGroupStatuses(orderNo, {
      mainStatus: 'CLOSED',
      finishedAt: true,
    });
    await this.repository.addEvent({
      orderNo,
      parentOrderNo: orderNo,
      eventType: 'OrderClosed',
      sourceService: 'orders',
      beforeStatusJson: {
        mainStatus: order.mainStatus,
      },
      afterStatusJson: {
        mainStatus: 'CLOSED',
      },
      payloadJson: {},
      idempotencyKey: `close:${orderNo}`,
      operator: 'ADMIN',
      requestId,
    });
  }

  async markException(orderNo: string, exceptionTag: string, requestId: string) {
    const pieces = await this.repository.listPieceOrders(orderNo);

    for (const piece of pieces) {
      await this.repository.updateStatuses(piece.orderNo, {
        exceptionTag,
      });
    }

    await this.repository.addEvent({
      orderNo,
      parentOrderNo: orderNo,
      eventType: 'OrderMarkedException',
      sourceService: 'orders',
      beforeStatusJson: {
        exceptionTag: null,
      },
      afterStatusJson: {
        exceptionTag,
      },
      payloadJson: {
        exceptionTag,
      },
      idempotencyKey: `exception:${orderNo}:${exceptionTag}`,
      operator: 'ADMIN',
      requestId,
    });
  }

  async addRemark(orderNo: string, remark: string, operatorUserId: string | null) {
    const pieces = await this.repository.listPieceOrders(orderNo);

    for (const piece of pieces) {
      await this.repository.addRemark(piece.orderNo, remark, operatorUserId);
    }
  }

  async scanTimeouts(now = new Date()) {
    const warningTransitions = await this.repository.transitionTimeoutWarnings(now);

    for (const order of warningTransitions) {
      const childOrder = await this.getSupplierExecutionContext(order.orderNo);
      await this.repository.addEvent({
        orderNo: order.orderNo,
        parentOrderNo: childOrder.parentOrderNo ?? childOrder.orderNo,
        eventType: 'OrderTimeoutWarning',
        sourceService: 'orders',
        sourceNo: null,
        beforeStatusJson: {
          monitorStatus: order.previousMonitorStatus,
        },
        afterStatusJson: {
          monitorStatus: 'TIMEOUT_WARNING',
        },
        payloadJson: {
          warningDeadlineAt: order.warningDeadlineAt,
          scannedAt: now.toISOString(),
        },
        idempotencyKey: `timeout-warning:${order.orderNo}`,
        operator: 'SYSTEM',
        requestId: order.requestId,
      });

      await this.syncOrderGroupState(childOrder.parentOrderNo ?? childOrder.orderNo);
    }

    const expiryTransitions = await this.repository.transitionTimeoutExpiry(now);

    for (const order of expiryTransitions) {
      const childOrder = await this.getSupplierExecutionContext(order.orderNo);
      const parentOrderNo = childOrder.parentOrderNo ?? childOrder.orderNo;
      if (!(order.previousMainStatus === 'REFUNDING' && order.previousRefundStatus === 'PENDING')) {
        await this.repository.addEvent({
          orderNo: order.orderNo,
          parentOrderNo,
          eventType: 'OrderTimedOut',
          sourceService: 'orders',
          sourceNo: null,
          beforeStatusJson: {
            mainStatus: order.previousMainStatus,
            supplierStatus: order.previousSupplierStatus,
            refundStatus: order.previousRefundStatus,
            monitorStatus: order.previousMonitorStatus,
          },
          afterStatusJson: {
            mainStatus: 'REFUNDING',
            supplierStatus: 'FAIL',
            refundStatus: 'PENDING',
            monitorStatus: 'TIMEOUT_WARNING',
          },
          payloadJson: {
            expireDeadlineAt: order.expireDeadlineAt,
            scannedAt: now.toISOString(),
          },
          idempotencyKey: `timeout-expired:${order.orderNo}`,
          operator: 'SYSTEM',
          requestId: order.requestId,
        });
      }

      await this.syncOrderGroupState(parentOrderNo);
      const currentOrder = await this.getNotificationContext(parentOrderNo);

      if (currentOrder.mainStatus === 'REFUNDED') {
        await this.handleRefundSucceeded({
          orderNo: parentOrderNo,
          sourceService: 'orders',
          sourceNo: null,
        });
        continue;
      }

      if (currentOrder.mainStatus !== 'REFUNDING' || currentOrder.refundStatus !== 'PENDING') {
        continue;
      }

      await this.refundPendingOrder(currentOrder, {
        throwOnFailure: false,
      });
    }

    const notificationRecoveryOrders =
      await this.repository.listTimeoutNotificationRecoveryCandidates(now);

    for (const order of notificationRecoveryOrders) {
      await this.handleRefundSucceeded({
        orderNo: order.parentOrderNo ?? order.orderNo,
        sourceService: 'orders',
        sourceNo: null,
      });
    }
  }

  async handleSupplierAccepted(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    status: 'ACCEPTED' | 'PROCESSING';
  }) {
    const order = await this.getSupplierExecutionContext(payload.orderNo);
    const parentOrderNo = order.parentOrderNo ?? order.orderNo;

    if (
      ['SUCCESS', 'REFUNDED', 'REFUNDING', 'CLOSED'].includes(order.mainStatus) ||
      order.refundStatus === 'PENDING'
    ) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'PROCESSING',
      supplierStatus: payload.status === 'PROCESSING' ? 'QUERYING' : 'ACCEPTED',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo,
      eventType: 'SupplierAccepted',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
      },
      afterStatusJson: {
        mainStatus: 'PROCESSING',
        supplierStatus: payload.status === 'PROCESSING' ? 'QUERYING' : 'ACCEPTED',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:${payload.status}`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await this.syncOrderGroupState(parentOrderNo);
  }

  async handleSupplierSucceeded(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    costPrice: number;
  }) {
    const order = await this.getSupplierExecutionContext(payload.orderNo);
    const parentOrderNo = order.parentOrderNo ?? order.orderNo;

    if (order.mainStatus === 'REFUNDED' && order.refundStatus === 'SUCCESS') {
      await this.repository.updateStatuses(order.orderNo, {
        monitorStatus: 'LATE_CALLBACK_EXCEPTION',
        exceptionTag: 'LATE_CALLBACK_EXCEPTION',
      });
      await this.repository.addEvent({
        orderNo: order.orderNo,
        parentOrderNo,
        eventType: 'SupplierLateSuccessAfterRefund',
        sourceService: 'suppliers',
        sourceNo: payload.supplierOrderNo,
        beforeStatusJson: {
          mainStatus: order.mainStatus,
          monitorStatus: order.monitorStatus,
          exceptionTag: order.exceptionTag,
        },
        afterStatusJson: {
          mainStatus: order.mainStatus,
          monitorStatus: 'LATE_CALLBACK_EXCEPTION',
          exceptionTag: 'LATE_CALLBACK_EXCEPTION',
        },
        payloadJson: payload,
        idempotencyKey: `${payload.supplierOrderNo}:LATE_SUCCESS`,
        operator: 'SYSTEM',
        requestId: order.requestId,
      });
      await this.syncOrderGroupState(parentOrderNo);
      return;
    }

    if (
      ['SUCCESS', 'REFUNDING', 'CLOSED'].includes(order.mainStatus) ||
      order.refundStatus === 'PENDING'
    ) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'SUCCESS',
      supplierStatus: 'SUCCESS',
      finishedAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo,
      eventType: 'SupplierSucceeded',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
      },
      afterStatusJson: {
        mainStatus: 'SUCCESS',
        supplierStatus: 'SUCCESS',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:SUCCESS`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    const aggregation = await this.syncOrderGroupState(parentOrderNo);

    if (
      aggregation.previous.mainStatus !== 'SUCCESS' &&
      aggregation.current.mainStatus === 'SUCCESS'
    ) {
      await this.ledgerContract.confirmOrderProfit({
        orderNo: aggregation.current.orderNo,
        salePrice: aggregation.current.totalSalePrice,
        purchasePrice: aggregation.current.totalPurchasePrice,
      });
      await eventBus.publish('NotificationRequested', {
        orderNo: aggregation.current.orderNo,
        channelId: aggregation.current.channelId,
        notifyType: 'WEBHOOK',
        triggerReason: 'ORDER_SUCCESS',
      });
    }
  }

  async handleSupplierFailed(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    reason: string;
  }) {
    const order = await this.getSupplierExecutionContext(payload.orderNo);
    const parentOrderNo = order.parentOrderNo ?? order.orderNo;

    if (['SUCCESS', 'REFUNDED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'FAIL',
      supplierStatus: 'FAIL',
      refundStatus: 'NONE',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo,
      eventType: 'SupplierFailed',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        supplierStatus: order.supplierStatus,
        refundStatus: order.refundStatus,
      },
      afterStatusJson: {
        mainStatus: 'FAIL',
        supplierStatus: 'FAIL',
        refundStatus: 'NONE',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:FAIL`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    const aggregation = await this.syncOrderGroupState(parentOrderNo);

    await this.repository.addEvent({
      orderNo: parentOrderNo,
      parentOrderNo,
      eventType: 'OrderRefunding',
      sourceService: 'orders',
      sourceNo: payload.supplierOrderNo,
      beforeStatusJson: {
        mainStatus: aggregation.previous.mainStatus,
        supplierStatus: aggregation.previous.supplierStatus,
        refundStatus: aggregation.previous.refundStatus,
      },
      afterStatusJson: {
        mainStatus: aggregation.current.mainStatus,
        supplierStatus: aggregation.current.supplierStatus,
        refundStatus: aggregation.current.refundStatus,
      },
      payloadJson: payload,
      idempotencyKey: `refunding:${payload.supplierOrderNo}`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await this.refundPendingOrder(await this.getNotificationContext(parentOrderNo), {
      throwOnFailure: false,
    });
  }

  async handleRefundSucceeded(payload: {
    orderNo: string;
    sourceService: string;
    sourceNo?: string | null;
  }) {
    const order = await this.getNotificationContext(payload.orderNo);
    const pieces = await this.repository.listPieceOrders(order.orderNo);

    if (order.mainStatus === 'REFUNDED') {
      if (['PENDING', 'RETRYING'].includes(order.notifyStatus)) {
        await eventBus.publish('NotificationRequested', {
          orderNo: order.orderNo,
          channelId: order.channelId,
          notifyType: 'WEBHOOK',
          triggerReason: 'REFUND_SUCCEEDED',
        });
      }
      return;
    }

    if (order.mainStatus !== 'REFUNDING' || order.refundStatus !== 'PENDING') {
      return;
    }

    for (const piece of pieces) {
      await this.repository.updateStatuses(piece.orderNo, {
        mainStatus: 'REFUNDED',
        refundStatus: 'SUCCESS',
        finishedAt: true,
      });
    }

    await this.repository.updateGroupStatuses(order.orderNo, {
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      finishedAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo: order.orderNo,
      eventType: 'RefundSucceeded',
      sourceService: payload.sourceService,
      sourceNo: payload.sourceNo ?? null,
      beforeStatusJson: {
        mainStatus: order.mainStatus,
        refundStatus: order.refundStatus,
      },
      afterStatusJson: {
        mainStatus: 'REFUNDED',
        refundStatus: 'SUCCESS',
      },
      payloadJson: payload,
      idempotencyKey: payload.sourceNo ?? `refund:${order.orderNo}`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await eventBus.publish('NotificationRequested', {
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType: 'WEBHOOK',
      triggerReason: 'REFUND_SUCCEEDED',
    });
  }

  async handleNotificationSucceeded(payload: { orderNo: string; taskNo: string }) {
    const order = await this.getOrderGroupByNo(payload.orderNo);
    await this.repository.updateGroupStatuses(order.orderNo, {
      notifyStatus: 'SUCCESS',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo: order.orderNo,
      eventType: 'NotificationSucceeded',
      sourceService: 'notifications',
      sourceNo: payload.taskNo,
      beforeStatusJson: {
        notifyStatus: order.notifyStatus,
      },
      afterStatusJson: {
        notifyStatus: 'SUCCESS',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.taskNo}:SUCCESS`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
  }

  async handleNotificationFailed(payload: { orderNo: string; taskNo: string; reason: string }) {
    const order = await this.getOrderGroupByNo(payload.orderNo);
    await this.repository.updateGroupStatuses(order.orderNo, {
      notifyStatus: 'DEAD_LETTER',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      parentOrderNo: order.orderNo,
      eventType: 'NotificationFailed',
      sourceService: 'notifications',
      sourceNo: payload.taskNo,
      beforeStatusJson: {
        notifyStatus: order.notifyStatus,
      },
      afterStatusJson: {
        notifyStatus: 'DEAD_LETTER',
      },
      payloadJson: payload,
      idempotencyKey: `${payload.taskNo}:FAIL`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });
  }
}
