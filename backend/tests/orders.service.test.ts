import { beforeEach, describe, expect, test } from 'bun:test';

import { eventBus } from '@/lib/event-bus';
import { OrdersService } from '@/modules/orders/orders.service';
import type { OrderRecord } from '@/modules/orders/orders.types';

function buildOrderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-id',
    orderNo: 'order-no-1',
    channelOrderNo: 'channel-order-1',
    channelId: 'channel-1',
    parentChannelId: null,
    mobile: '13800130000',
    province: 'Shanghai',
    ispName: 'CMCC',
    faceValue: 50,
    requestedProductType: 'MIXED',
    matchedProductId: 'product-1',
    salePrice: 48,
    purchasePrice: 45,
    currency: 'CNY',
    mainStatus: 'CREATED',
    paymentStatus: 'PAID',
    supplierStatus: 'WAIT_SUBMIT',
    notifyStatus: 'PENDING',
    refundStatus: 'NONE',
    monitorStatus: 'NORMAL',
    channelSnapshotJson: {
      channel: {
        id: 'channel-1',
      },
      pricePolicy: {
        salePrice: 48,
      },
    },
    productSnapshotJson: {
      product: {
        id: 'product-1',
      },
    },
    callbackSnapshotJson: {
      callbackConfig: {
        callbackUrl: 'mock://success',
        secretEncrypted: 'encrypted-secret',
      },
    },
    supplierRouteSnapshotJson: {
      supplierCandidates: [
        {
          supplierId: 'supplier-1',
          costPrice: 45,
        },
      ],
    },
    riskSnapshotJson: {
      decision: 'PASS',
      reason: 'ok',
    },
    extJson: {},
    exceptionTag: null,
    remark: null,
    version: 1,
    requestId: 'req-1',
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    warningDeadlineAt: '2026-03-28T02:30:00.000Z',
    expireDeadlineAt: '2026-03-28T03:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  eventBus.clear();
});

describe('OrdersService.createOrder', () => {
  test('returns the existing order when a concurrent duplicate insert hits the unique key', async () => {
    const createdOrder = buildOrderRecord();
    let createCalls = 0;
    let addEventCalls = 0;
    let debitCalls = 0;
    let enqueueCalls = 0;
    let lookupCalls = 0;
    let pendingDuplicateLookups = 0;
    let releaseDuplicateLookups!: () => void;
    const duplicateLookupsReady = new Promise<void>((resolve) => {
      releaseDuplicateLookups = resolve;
    });

    const repository = {
      async withCreateOrderLock(
        _channelId: string,
        _channelOrderNo: string,
        callback: () => Promise<OrderRecord>,
      ) {
        return callback();
      },
      async findByChannelOrder() {
        lookupCalls += 1;
        pendingDuplicateLookups += 1;

        if (pendingDuplicateLookups <= 2) {
          if (pendingDuplicateLookups === 2) {
            releaseDuplicateLookups();
          }

          await duplicateLookupsReady;
          return null;
        }

        return createdOrder;
      },
      async createOrder() {
        createCalls += 1;

        if (createCalls === 1) {
          return createdOrder;
        }

        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
      },
      async addEvent() {
        addEventCalls += 1;
      },
      async deleteOrder() {
        throw new Error('deleteOrder should not be called for duplicate idempotency');
      },
      async findByOrderNo() {
        return createdOrder;
      },
    };

    const channelContract = {
      async authenticateOpenRequest() {
        throw new Error('authenticateOpenRequest should not be called in service test');
      },
      async getOrderPolicy() {
        return {
          channel: {
            id: 'channel-1',
            channelCode: 'demo-channel',
            channelName: 'Demo Channel',
            status: 'ACTIVE',
          },
          pricePolicy: {
            salePrice: 48,
          },
          callbackConfig: {
            callbackUrl: 'mock://success',
            secretEncrypted: 'encrypted-secret',
          },
        };
      },
      async getCallbackConfig() {
        throw new Error('getCallbackConfig should not be called in service test');
      },
      async getChannelById() {
        throw new Error('getChannelById should not be called in service test');
      },
    };
    const productContract = {
      async matchRechargeProduct() {
        return {
          mobileContext: {
            mobile: createdOrder.mobile,
            province: String(createdOrder.province),
            ispName: String(createdOrder.ispName),
          },
          product: {
            id: createdOrder.matchedProductId,
            productType: createdOrder.requestedProductType,
            faceValue: createdOrder.faceValue,
          },
          supplierCandidates: [
            {
              supplierId: 'supplier-1',
              costPrice: createdOrder.purchasePrice,
            },
          ],
        };
      },
    };
    const riskContract = {
      async preCheck() {
        return {
          decision: 'PASS',
          reason: 'ok',
        };
      },
    };
    const ledgerContract = {
      async ensureBalanceSufficient() {},
      async debitOrderAmount() {
        debitCalls += 1;
        return {
          referenceNo: 'ledger-ref-1',
        };
      },
      async refundOrderAmount() {
        throw new Error('refundOrderAmount should not be called in service test');
      },
      async confirmOrderProfit() {},
    };
    const workerContract = {
      async enqueue() {
        enqueueCalls += 1;
        return {
          id: 'job-1',
          jobType: 'supplier.submit',
          businessKey: createdOrder.orderNo,
          payloadJson: {
            orderNo: createdOrder.orderNo,
          },
          status: 'READY',
          attemptCount: 0,
          maxAttempts: 5,
          nextRunAt: new Date().toISOString(),
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      async schedule() {
        throw new Error('schedule should not be called in service test');
      },
      async processReadyJobs() {},
      registerHandler() {},
      listRegisteredJobTypes() {
        return [];
      },
      async retry() {},
      async cancel() {},
      async listDeadLetters() {
        return [];
      },
    };

    const service = new OrdersService(
      repository as never,
      channelContract as never,
      productContract as never,
      riskContract as never,
      ledgerContract as never,
      workerContract as never,
    );

    const input = {
      channelId: createdOrder.channelId,
      channelOrderNo: createdOrder.channelOrderNo,
      mobile: createdOrder.mobile,
      faceValue: createdOrder.faceValue,
      productType: createdOrder.requestedProductType,
      extJson: {},
      requestId: 'req-1',
      clientIp: '127.0.0.1',
    } as const;

    const [firstResult, secondResult] = await Promise.all([
      service.createOrder(input),
      service.createOrder(input),
    ]);

    expect(firstResult.orderNo).toBe(createdOrder.orderNo);
    expect(secondResult.orderNo).toBe(createdOrder.orderNo);
    expect(lookupCalls).toBe(3);
    expect(createCalls).toBe(2);
    expect(addEventCalls).toBe(1);
    expect(debitCalls).toBe(1);
    expect(enqueueCalls).toBe(1);
  });

  test('does not let a duplicate request observe the order before the first create flow finishes', async () => {
    const createdOrder = buildOrderRecord({
      orderNo: 'order-no-serialized',
      channelOrderNo: 'channel-order-serialized',
    });
    let createCalls = 0;
    let debitCalls = 0;
    let enqueueCalls = 0;
    let releaseDebit!: () => void;
    let signalDebitStarted!: () => void;
    const debitGate = new Promise<void>((resolve) => {
      releaseDebit = resolve;
    });
    const debitStarted = new Promise<void>((resolve) => {
      signalDebitStarted = resolve;
    });
    let orderVisible = false;
    let activeLock = Promise.resolve();

    const repository = {
      async withCreateOrderLock(
        _channelId: string,
        _channelOrderNo: string,
        callback: () => Promise<OrderRecord>,
      ) {
        const previousLock = activeLock;
        let releaseLock!: () => void;
        activeLock = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        await previousLock;

        try {
          return await callback();
        } finally {
          releaseLock();
        }
      },
      async findByChannelOrder() {
        return orderVisible ? createdOrder : null;
      },
      async createOrder() {
        createCalls += 1;
        orderVisible = true;
        return createdOrder;
      },
      async addEvent() {},
      async deleteOrder() {
        throw new Error('deleteOrder should not be called in serialization test');
      },
      async findByOrderNo() {
        return createdOrder;
      },
    };

    const channelContract = {
      async authenticateOpenRequest() {
        throw new Error('authenticateOpenRequest should not be called in service test');
      },
      async getOrderPolicy() {
        return {
          channel: {
            id: 'channel-1',
            channelCode: 'demo-channel',
            channelName: 'Demo Channel',
            status: 'ACTIVE',
          },
          pricePolicy: {
            salePrice: 48,
          },
          callbackConfig: {
            callbackUrl: 'mock://success',
            secretEncrypted: 'encrypted-secret',
          },
        };
      },
      async getCallbackConfig() {
        throw new Error('getCallbackConfig should not be called in service test');
      },
      async getChannelById() {
        throw new Error('getChannelById should not be called in service test');
      },
    };
    const productContract = {
      async matchRechargeProduct() {
        return {
          mobileContext: {
            mobile: createdOrder.mobile,
            province: String(createdOrder.province),
            ispName: String(createdOrder.ispName),
          },
          product: {
            id: createdOrder.matchedProductId,
            productType: createdOrder.requestedProductType,
            faceValue: createdOrder.faceValue,
          },
          supplierCandidates: [
            {
              supplierId: 'supplier-1',
              costPrice: createdOrder.purchasePrice,
            },
          ],
        };
      },
    };
    const riskContract = {
      async preCheck() {
        return {
          decision: 'PASS',
          reason: 'ok',
        };
      },
    };
    const ledgerContract = {
      async ensureBalanceSufficient() {},
      async debitOrderAmount() {
        debitCalls += 1;
        signalDebitStarted();
        await debitGate;
        return {
          referenceNo: 'ledger-ref-serialized',
        };
      },
      async refundOrderAmount() {
        throw new Error('refundOrderAmount should not be called in service test');
      },
      async confirmOrderProfit() {},
    };
    const workerContract = {
      async enqueue() {
        enqueueCalls += 1;
        return {
          id: 'job-serialized',
          jobType: 'supplier.submit',
          businessKey: createdOrder.orderNo,
          payloadJson: {
            orderNo: createdOrder.orderNo,
          },
          status: 'READY',
          attemptCount: 0,
          maxAttempts: 5,
          nextRunAt: new Date().toISOString(),
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      async schedule() {
        throw new Error('schedule should not be called in service test');
      },
      async processReadyJobs() {},
      registerHandler() {},
      listRegisteredJobTypes() {
        return [];
      },
      async retry() {},
      async cancel() {},
      async listDeadLetters() {
        return [];
      },
    };

    const service = new OrdersService(
      repository as never,
      channelContract as never,
      productContract as never,
      riskContract as never,
      ledgerContract as never,
      workerContract as never,
    );

    const input = {
      channelId: createdOrder.channelId,
      channelOrderNo: createdOrder.channelOrderNo,
      mobile: createdOrder.mobile,
      faceValue: createdOrder.faceValue,
      productType: createdOrder.requestedProductType,
      extJson: {},
      requestId: 'req-serialized',
      clientIp: '127.0.0.1',
    } as const;

    const firstCreate = service.createOrder(input);
    await debitStarted;

    let secondResolved = false;
    const secondCreate = service.createOrder(input).then((result) => {
      secondResolved = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(secondResolved).toBe(false);

    releaseDebit();

    const [firstResult, secondResult] = await Promise.all([firstCreate, secondCreate]);

    expect(firstResult.orderNo).toBe(createdOrder.orderNo);
    expect(secondResult.orderNo).toBe(createdOrder.orderNo);
    expect(createCalls).toBe(1);
    expect(debitCalls).toBe(1);
    expect(enqueueCalls).toBe(1);
  });

  test('refunds and finalizes the order when initial supplier.submit enqueue fails after debit', async () => {
    let currentOrder = buildOrderRecord({
      orderNo: 'order-no-enqueue-fail',
      channelOrderNo: 'channel-order-enqueue-fail',
    });
    let debitCalls = 0;
    let refundCalls = 0;
    const eventTypes: string[] = [];

    const repository = {
      async withCreateOrderLock(
        _channelId: string,
        _channelOrderNo: string,
        callback: () => Promise<OrderRecord>,
      ) {
        return callback();
      },
      async findByChannelOrder() {
        return null;
      },
      async createOrder() {
        return currentOrder;
      },
      async addEvent(input: { eventType: string }) {
        eventTypes.push(input.eventType);
      },
      async deleteOrder() {
        throw new Error('deleteOrder should not be called after a successful debit');
      },
      async findByOrderNo() {
        return currentOrder;
      },
      async updateStatuses(
        _orderNo: string,
        update: {
          mainStatus?: OrderRecord['mainStatus'];
          supplierStatus?: OrderRecord['supplierStatus'];
          refundStatus?: OrderRecord['refundStatus'];
          finishedAt?: boolean;
        },
      ) {
        currentOrder = {
          ...currentOrder,
          mainStatus: update.mainStatus ?? currentOrder.mainStatus,
          supplierStatus: update.supplierStatus ?? currentOrder.supplierStatus,
          refundStatus: update.refundStatus ?? currentOrder.refundStatus,
          finishedAt:
            update.finishedAt === true ? '2026-03-29T00:00:00.000Z' : currentOrder.finishedAt,
        };
      },
    };

    const channelContract = {
      async authenticateOpenRequest() {
        throw new Error('authenticateOpenRequest should not be called in service test');
      },
      async getOrderPolicy() {
        return {
          channel: {
            id: 'channel-1',
            channelCode: 'demo-channel',
            channelName: 'Demo Channel',
            status: 'ACTIVE',
          },
          pricePolicy: {
            salePrice: 48,
          },
          callbackConfig: {
            callbackUrl: 'mock://success',
            secretEncrypted: 'encrypted-secret',
          },
        };
      },
      async getCallbackConfig() {
        throw new Error('getCallbackConfig should not be called in service test');
      },
      async getChannelById() {
        throw new Error('getChannelById should not be called in service test');
      },
    };
    const productContract = {
      async matchRechargeProduct() {
        return {
          mobileContext: {
            mobile: currentOrder.mobile,
            province: String(currentOrder.province),
            ispName: String(currentOrder.ispName),
          },
          product: {
            id: currentOrder.matchedProductId,
            productType: currentOrder.requestedProductType,
            faceValue: currentOrder.faceValue,
          },
          supplierCandidates: [
            {
              supplierId: 'supplier-1',
              costPrice: currentOrder.purchasePrice,
            },
          ],
        };
      },
    };
    const riskContract = {
      async preCheck() {
        return {
          decision: 'PASS',
          reason: 'ok',
        };
      },
    };
    const ledgerContract = {
      async ensureBalanceSufficient() {},
      async debitOrderAmount() {
        debitCalls += 1;
        return {
          referenceNo: 'ledger-ref-enqueue-fail',
        };
      },
      async refundOrderAmount() {
        refundCalls += 1;
        return {
          referenceNo: 'ledger-refund-enqueue-fail',
        };
      },
      async confirmOrderProfit() {},
    };
    const workerContract = {
      async enqueue() {
        throw new Error('enqueue failed');
      },
      async schedule() {
        throw new Error('schedule should not be called in service test');
      },
      async processReadyJobs() {},
      registerHandler() {},
      listRegisteredJobTypes() {
        return [];
      },
      async retry() {},
      async cancel() {},
      async listDeadLetters() {
        return [];
      },
    };

    const service = new OrdersService(
      repository as never,
      channelContract as never,
      productContract as never,
      riskContract as never,
      ledgerContract as never,
      workerContract as never,
    );

    await expect(
      service.createOrder({
        channelId: currentOrder.channelId,
        channelOrderNo: currentOrder.channelOrderNo,
        mobile: currentOrder.mobile,
        faceValue: currentOrder.faceValue,
        productType: currentOrder.requestedProductType,
        extJson: {},
        requestId: 'req-enqueue-fail',
        clientIp: '127.0.0.1',
      }),
    ).rejects.toThrow('enqueue failed');

    expect(debitCalls).toBe(1);
    expect(refundCalls).toBe(1);
    expect(currentOrder.mainStatus).toBe('REFUNDED');
    expect(currentOrder.supplierStatus).toBe('FAIL');
    expect(currentOrder.refundStatus).toBe('SUCCESS');
    expect(currentOrder.finishedAt).toBeTruthy();
    expect(eventTypes).toContain('SupplierSubmitEnqueueFailed');
    expect(eventTypes).toContain('RefundSucceeded');
  });
});

describe('OrdersService.retryNotification', () => {
  test('aligns notification next retry time with worker scheduling and raises max attempts to notification policy', async () => {
    const repository = {
      async findByOrderNo() {
        return buildOrderRecord({
          orderNo: 'order-notify-retry',
        });
      },
    };

    const scheduledAt = new Date('2026-03-30T01:23:45.000Z');
    const scheduleCalls: Array<Record<string, unknown>> = [];
    const syncCalls: Array<{ taskNo: string; nextRetryAt: Date }> = [];

    const workerContract = {
      async enqueue() {
        throw new Error('enqueue should not be called in retryNotification test');
      },
      async schedule(input: Record<string, unknown>) {
        scheduleCalls.push(input);
        return {
          id: 'job-notification-retry',
          jobType: 'notification.deliver',
          businessKey: 'task-notification-retry',
          payloadJson: {
            taskNo: 'task-notification-retry',
          },
          status: 'RETRY_WAIT',
          attemptCount: 2,
          maxAttempts: Number(input.maxAttempts ?? 0),
          nextRunAt: scheduledAt.toISOString(),
          lastError: 'previous failure',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
      async processReadyJobs() {},
      registerHandler() {},
      listRegisteredJobTypes() {
        return [];
      },
      async retry() {},
      async cancel() {},
      async listDeadLetters() {
        return [];
      },
    };

    const notificationsRepository = {
      async findLatestTaskByOrderNo(orderNo: string) {
        expect(orderNo).toBe('order-notify-retry');
        return {
          taskNo: 'task-notification-retry',
        };
      },
      async syncNextRetryAt(taskNo: string, nextRetryAt: Date) {
        syncCalls.push({ taskNo, nextRetryAt });
      },
    };

    const service = new OrdersService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workerContract as never,
      notificationsRepository as never,
    );

    await service.retryNotification('order-notify-retry');

    expect(scheduleCalls).toHaveLength(1);
    expect(scheduleCalls[0]).toMatchObject({
      jobType: 'notification.deliver',
      businessKey: 'task-notification-retry',
      maxAttempts: 7,
    });
    expect(syncCalls).toEqual([
      {
        taskNo: 'task-notification-retry',
        nextRetryAt: scheduledAt,
      },
    ]);
  });
});

describe('OrdersService.manual-close-and-late-success', () => {
  test('closing a non-success order triggers refund and finalizes as refunded', async () => {
    let currentOrder = buildOrderRecord({
      orderNo: 'order-close-refund',
      mainStatus: 'PROCESSING',
      supplierStatus: 'QUERYING',
      refundStatus: 'NONE',
      notifyStatus: 'PENDING',
    });
    let refundCalls = 0;
    const eventTypes: string[] = [];

    const repository = {
      async findByOrderNo() {
        return currentOrder;
      },
      async updateStatuses(_orderNo: string, update: Record<string, unknown>) {
        currentOrder = {
          ...currentOrder,
          mainStatus:
            (update.mainStatus as typeof currentOrder.mainStatus) ?? currentOrder.mainStatus,
          supplierStatus:
            (update.supplierStatus as typeof currentOrder.supplierStatus) ??
            currentOrder.supplierStatus,
          refundStatus:
            (update.refundStatus as typeof currentOrder.refundStatus) ?? currentOrder.refundStatus,
          finishedAt: update.finishedAt ? new Date().toISOString() : currentOrder.finishedAt,
        };
      },
      async addEvent(input: { eventType: string }) {
        eventTypes.push(input.eventType);
      },
    };

    const ledgerContract = {
      async refundOrderAmount() {
        refundCalls += 1;
        return {
          referenceNo: 'refund-close-1',
        };
      },
    };

    const service = new OrdersService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      ledgerContract as never,
      {} as never,
      {
        async findLatestTaskByOrderNo() {
          return null;
        },
        async syncNextRetryAt() {},
      } as never,
    );

    await service.closeOrder(currentOrder.orderNo, 'req-close');

    expect(refundCalls).toBe(1);
    expect(currentOrder.mainStatus).toBe('REFUNDED');
    expect(currentOrder.refundStatus).toBe('SUCCESS');
    expect(currentOrder.supplierStatus).toBe('FAIL');
    expect(currentOrder.finishedAt).toBeTruthy();
    expect(eventTypes).toContain('OrderClosed');
    expect(eventTypes).toContain('RefundSucceeded');
  });

  test('supplier success after refund marks late callback exception instead of returning silently', async () => {
    let currentOrder = buildOrderRecord({
      orderNo: 'order-refunded-late-success',
      mainStatus: 'REFUNDED',
      supplierStatus: 'FAIL',
      refundStatus: 'SUCCESS',
      monitorStatus: 'NORMAL',
      exceptionTag: null,
    });
    const eventTypes: string[] = [];

    const repository = {
      async findByOrderNo() {
        return currentOrder;
      },
      async updateStatuses(_orderNo: string, update: Record<string, unknown>) {
        currentOrder = {
          ...currentOrder,
          monitorStatus:
            (update.monitorStatus as typeof currentOrder.monitorStatus) ??
            currentOrder.monitorStatus,
          exceptionTag:
            (update.exceptionTag as typeof currentOrder.exceptionTag) ?? currentOrder.exceptionTag,
        };
      },
      async addEvent(input: { eventType: string }) {
        eventTypes.push(input.eventType);
      },
    };

    const service = new OrdersService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        async findLatestTaskByOrderNo() {
          return null;
        },
        async syncNextRetryAt() {},
      } as never,
    );

    await service.handleSupplierSucceeded({
      orderNo: currentOrder.orderNo,
      supplierId: 'supplier-1',
      supplierOrderNo: 'supplier-order-late-success',
      costPrice: 45,
    });

    expect(currentOrder.mainStatus).toBe('REFUNDED');
    expect(currentOrder.monitorStatus).toBe('LATE_CALLBACK_EXCEPTION');
    expect(currentOrder.exceptionTag).toBe('LATE_CALLBACK_EXCEPTION');
    expect(eventTypes).toContain('SupplierLateSuccessAfterRefund');
  });
});
