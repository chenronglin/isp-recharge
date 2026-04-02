/**
 * 进程内领域事件总线。
 * 在当前模块化单体架构下，使用它来模拟服务之间的标准事件驱动。
 */
export type AppEventMap = {
  SupplierAccepted: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    status: 'ACCEPTED' | 'PROCESSING';
  };
  SupplierSucceeded: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    costPrice: number;
  };
  SupplierFailed: {
    orderNo: string;
    supplierId: string;
    supplierOrderNo: string;
    reason: string;
  };
  NotificationRequested: {
    orderNo: string;
    channelId: string;
    notifyType: 'WEBHOOK';
    triggerReason: 'ORDER_SUCCESS' | 'REFUND_SUCCEEDED';
  };
  NotificationSucceeded: {
    orderNo: string;
    taskNo: string;
  };
  NotificationFailed: {
    orderNo: string;
    taskNo: string;
    reason: string;
  };
  SettlementTriggered: {
    orderNo: string;
    actionType: 'ORDER_SUCCESS' | 'ORDER_REFUND';
  };
};

type EventHandler<TPayload> = (payload: TPayload) => Promise<void> | void;

export class EventBus<TEventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEventMap, EventHandler<unknown>[]>();

  subscribe<TKey extends keyof TEventMap>(eventName: TKey, handler: EventHandler<TEventMap[TKey]>) {
    const handlers = this.listeners.get(eventName) ?? [];
    handlers.push(handler as EventHandler<unknown>);
    this.listeners.set(eventName, handlers);
  }

  async publish<TKey extends keyof TEventMap>(
    eventName: TKey,
    payload: TEventMap[TKey],
  ): Promise<void> {
    const handlers = this.listeners.get(eventName) ?? [];

    for (const handler of handlers) {
      await handler(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const eventBus = new EventBus<AppEventMap>();
