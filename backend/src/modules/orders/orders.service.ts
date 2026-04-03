import { badRequest, forbidden, notFound } from '@/lib/errors';
import { eventBus } from '@/lib/event-bus';
import type { ChannelContract } from '@/modules/channels/contracts';
import type { LedgerContract } from '@/modules/ledger/contracts';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository';
import { notificationWorkerMaxAttempts } from '@/modules/notifications/retry-policy';
import type { OrderContract } from '@/modules/orders/contracts';
import type { OrdersRepository } from '@/modules/orders/orders.repository';
import type {
  OpenOrderEventRecord,
  OpenOrderRecord,
  OrderEventRecord,
  OrderListFilters,
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

export class OrdersService implements OrderContract {
  private readonly notificationsRepository: Pick<
    NotificationsRepository,
    'findLatestTaskByOrderNo' | 'syncNextRetryAt'
  >;

  constructor(
    private readonly repository: OrdersRepository,
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

  async listOrders(filters: OrderListFilters = {}) {
    return this.repository.listOrders(filters);
  }

  async getOrderByNo(orderNo: string): Promise<OrderRecord> {
    const order = await this.repository.findByOrderNo(orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  async getOrderByNoForChannel(channelId: string, orderNo: string): Promise<OrderRecord> {
    const order = await this.repository.findByOrderNoAndChannel(channelId, orderNo);

    if (!order) {
      throw notFound('订单不存在');
    }

    return order;
  }

  async getSupplierExecutionContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async getNotificationContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async getLedgerContext(orderNo: string) {
    return this.getOrderByNo(orderNo);
  }

  async listEvents(orderNo: string) {
    return this.repository.listEvents(orderNo);
  }

  async listEventsForChannel(channelId: string, orderNo: string) {
    await this.getOrderByNoForChannel(channelId, orderNo);
    return this.repository.listEvents(orderNo);
  }

  toOpenOrderRecord(order: OrderRecord): OpenOrderRecord {
    return {
      orderNo: order.orderNo,
      channelOrderNo: order.channelOrderNo,
      mobile: order.mobile,
      province: order.province,
      ispName: order.ispName,
      faceValue: order.faceValue,
      matchedProductId: order.matchedProductId,
      salePrice: order.salePrice,
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
    return this.toOpenOrderRecord(await this.getOrderByNoForChannel(channelId, orderNo));
  }

  async listOpenEventsForChannel(
    channelId: string,
    orderNo: string,
  ): Promise<OpenOrderEventRecord[]> {
    const events = await this.listEventsForChannel(channelId, orderNo);
    return events.map((event) => this.toOpenOrderEventRecord(event));
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
      const existing = await this.repository.findByChannelOrder(
        input.channelId,
        input.channelOrderNo,
      );

      if (existing) {
        return existing;
      }

      const matched = await this.productContract.matchRechargeProduct({
        mobile: input.mobile,
        faceValue: input.faceValue,
        productType: input.productType,
      });
      const policy = await this.channelContract.getOrderPolicy({
        channelId: input.channelId,
        productId: matched.product.id,
        orderAmount: matched.product.faceValue,
      });

      if (!policy.pricePolicy) {
        throw badRequest('渠道未配置销售价格');
      }

      const salePrice = Number(policy.pricePolicy.salePrice);
      const purchasePrice = Number(matched.supplierCandidates[0]?.costPrice ?? 0);

      if (salePrice < purchasePrice) {
        throw badRequest('渠道销售价不得低于采购价');
      }

      await this.ledgerContract.ensureBalanceSufficient({
        channelId: input.channelId,
        amount: salePrice,
      });

      const riskDecision = await this.riskContract.preCheck({
        channelId: input.channelId,
        amount: salePrice,
        ip: input.clientIp,
        mobile: matched.mobileContext.mobile,
      });

      if (riskDecision.decision !== 'PASS') {
        throw forbidden(riskDecision.reason);
      }

      const now = Date.now();
      const isFast = matched.product.productType === 'FAST';
      const warningDeadlineAt = new Date(now + (isFast ? 10 : 150) * 60 * 1000);
      const expireDeadlineAt = new Date(now + (isFast ? 60 : 180) * 60 * 1000);

      let order: OrderRecord;

      try {
        order = await this.repository.createOrder({
          channelOrderNo: input.channelOrderNo,
          channelId: input.channelId,
          parentChannelId: null,
          mobile: matched.mobileContext.mobile,
          province: matched.mobileContext.province,
          ispName: matched.mobileContext.ispName,
          faceValue: input.faceValue,
          requestedProductType: input.productType ?? 'MIXED',
          matchedProductId: matched.product.id,
          salePrice,
          purchasePrice,
          mainStatus: 'CREATED',
          supplierStatus: 'WAIT_SUBMIT',
          notifyStatus: 'PENDING',
          refundStatus: 'NONE',
          monitorStatus: 'NORMAL',
          warningDeadlineAt,
          expireDeadlineAt,
          channelSnapshotJson: {
            channel: policy.channel,
            pricePolicy: policy.pricePolicy,
          },
          productSnapshotJson: {
            product: matched.product,
          },
          callbackSnapshotJson: {
            callbackConfig: policy.callbackConfig,
          },
          supplierRouteSnapshotJson: {
            supplierCandidates: matched.supplierCandidates,
          },
          riskSnapshotJson: {
            ...riskDecision,
          },
          extJson: input.extJson ?? {},
          requestId: input.requestId,
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          const conflictedOrder = await this.repository.findByChannelOrder(
            input.channelId,
            input.channelOrderNo,
          );

          if (conflictedOrder) {
            return conflictedOrder;
          }
        }

        throw error;
      }

      await this.repository.addEvent({
        orderNo: order.orderNo,
        eventType: 'OrderCreated',
        sourceService: 'orders',
        sourceNo: null,
        beforeStatusJson: {},
        afterStatusJson: {
          mainStatus: order.mainStatus,
          supplierStatus: order.supplierStatus,
          notifyStatus: order.notifyStatus,
          refundStatus: order.refundStatus,
        },
        payloadJson: {
          mobile: order.mobile,
          faceValue: order.faceValue,
          requestedProductType: order.requestedProductType,
          matchedProductId: order.matchedProductId,
          riskDecision,
        },
        idempotencyKey: `${input.channelId}:${input.channelOrderNo}`,
        operator: 'SYSTEM',
        requestId: input.requestId,
      });

      try {
        await this.ledgerContract.debitOrderAmount({
          channelId: order.channelId,
          orderNo: order.orderNo,
          amount: order.salePrice,
        });
      } catch (error) {
        await this.repository.deleteOrder(order.orderNo);
        throw error;
      }

      try {
        await this.workerContract.enqueue({
          jobType: 'supplier.submit',
          businessKey: order.orderNo,
          payload: {
            orderNo: order.orderNo,
          },
        });
      } catch (error) {
        await this.compensateInitialSubmitEnqueueFailure(
          order,
          error instanceof Error ? error.message : 'supplier.submit enqueue failed',
        );
        throw error;
      }

      return this.getOrderByNo(order.orderNo);
    });
  }

  private async compensateInitialSubmitEnqueueFailure(order: OrderRecord, reason: string) {
    const currentOrder = await this.getOrderByNo(order.orderNo);

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

    await this.refundPendingOrder(currentOrder, {
      throwOnFailure: false,
    });
  }

  async retryNotification(orderNo: string) {
    await this.getOrderByNo(orderNo);

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

    await this.refundPendingOrder(await this.getOrderByNo(orderNo), {
      throwOnFailure: true,
    });
  }

  async closeOrder(orderNo: string, requestId: string) {
    const order = await this.getOrderByNo(orderNo);

    if (!['SUCCESS', 'REFUNDED', 'CLOSED'].includes(order.mainStatus)) {
      await this.repository.updateStatuses(orderNo, {
        mainStatus: 'REFUNDING',
        supplierStatus: 'FAIL',
        refundStatus: 'PENDING',
      });
      await this.repository.addEvent({
        orderNo,
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

      await this.refundPendingOrder(await this.getOrderByNo(orderNo), {
        throwOnFailure: false,
      });
      return;
    }

    await this.repository.updateStatuses(orderNo, {
      mainStatus: 'CLOSED',
      finishedAt: true,
    });
    await this.repository.addEvent({
      orderNo,
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
    const order = await this.getOrderByNo(orderNo);
    await this.repository.updateStatuses(orderNo, {
      exceptionTag,
    });
    await this.repository.addEvent({
      orderNo,
      eventType: 'OrderMarkedException',
      sourceService: 'orders',
      beforeStatusJson: {
        exceptionTag: order.exceptionTag,
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
    await this.repository.addRemark(orderNo, remark, operatorUserId);
  }

  async scanTimeouts(now = new Date()) {
    const warningTransitions = await this.repository.transitionTimeoutWarnings(now);

    for (const order of warningTransitions) {
      await this.repository.addEvent({
        orderNo: order.orderNo,
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
    }

    const expiryTransitions = await this.repository.transitionTimeoutExpiry(now);

    for (const order of expiryTransitions) {
      if (!(order.previousMainStatus === 'REFUNDING' && order.previousRefundStatus === 'PENDING')) {
        await this.repository.addEvent({
          orderNo: order.orderNo,
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

      const currentOrder = await this.getOrderByNo(order.orderNo);

      if (currentOrder.mainStatus === 'REFUNDED') {
        await this.handleRefundSucceeded({
          orderNo: currentOrder.orderNo,
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
        orderNo: order.orderNo,
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
    const order = await this.getOrderByNo(payload.orderNo);

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
  }

  async handleSupplierSucceeded(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    costPrice: number;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (order.mainStatus === 'REFUNDED' && order.refundStatus === 'SUCCESS') {
      await this.repository.updateStatuses(order.orderNo, {
        monitorStatus: 'LATE_CALLBACK_EXCEPTION',
        exceptionTag: 'LATE_CALLBACK_EXCEPTION',
      });
      await this.repository.addEvent({
        orderNo: order.orderNo,
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

    await this.ledgerContract.confirmOrderProfit({
      orderNo: order.orderNo,
      salePrice: order.salePrice,
      purchasePrice: payload.costPrice || order.purchasePrice,
    });
    await eventBus.publish('NotificationRequested', {
      orderNo: order.orderNo,
      channelId: order.channelId,
      notifyType: 'WEBHOOK',
      triggerReason: 'ORDER_SUCCESS',
    });
  }

  async handleSupplierFailed(payload: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    reason: string;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

    if (['SUCCESS', 'REFUNDED'].includes(order.mainStatus)) {
      return;
    }

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'REFUNDING',
      supplierStatus: 'FAIL',
      refundStatus: 'PENDING',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
      eventType: 'SupplierFailed',
      sourceService: 'suppliers',
      sourceNo: payload.supplierOrderNo,
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
      payloadJson: payload,
      idempotencyKey: `${payload.supplierOrderNo}:FAIL`,
      operator: 'SYSTEM',
      requestId: order.requestId,
    });

    await this.refundPendingOrder(await this.getOrderByNo(order.orderNo), {
      throwOnFailure: false,
    });
  }

  async handleRefundSucceeded(payload: {
    orderNo: string;
    sourceService: string;
    sourceNo?: string | null;
  }) {
    const order = await this.getOrderByNo(payload.orderNo);

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

    await this.repository.updateStatuses(order.orderNo, {
      mainStatus: 'REFUNDED',
      refundStatus: 'SUCCESS',
      finishedAt: true,
    });

    await this.repository.addEvent({
      orderNo: order.orderNo,
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
    const order = await this.getOrderByNo(payload.orderNo);
    await this.repository.updateStatuses(order.orderNo, {
      notifyStatus: 'SUCCESS',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
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
    const order = await this.getOrderByNo(payload.orderNo);
    await this.repository.updateStatuses(order.orderNo, {
      notifyStatus: 'DEAD_LETTER',
    });
    await this.repository.addEvent({
      orderNo: order.orderNo,
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
