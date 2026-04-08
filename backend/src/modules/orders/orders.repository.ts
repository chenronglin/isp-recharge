import { generateBusinessNo, generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { parseJsonValue } from '@/lib/utils';
import { ordersSql } from '@/modules/orders/orders.sql';
import type {
  MainOrderStatus,
  OrderEventRecord,
  OrderEventListFilters,
  OrderListFilters,
  OrderMonitorStatus,
  OrderNotifyStatus,
  OrderRecord,
  OrderRefundStatus,
  RequestedProductType,
  SupplierOrderStatus,
} from '@/modules/orders/orders.types';

interface TimeoutWarningTransition {
  orderNo: string;
  requestId: string;
  warningDeadlineAt: string | null;
  previousMonitorStatus: OrderMonitorStatus;
}

interface TimeoutExpiryTransition {
  orderNo: string;
  requestId: string;
  expireDeadlineAt: string | null;
  previousMainStatus: MainOrderStatus;
  previousSupplierStatus: SupplierOrderStatus;
  previousRefundStatus: OrderRefundStatus;
  previousMonitorStatus: OrderMonitorStatus;
}

export class OrdersRepository {
  async withCreateOrderLock<T>(
    channelId: string,
    channelOrderNo: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    return db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`order:create:${channelId}:${channelOrderNo}`}))`;
      return callback();
    });
  }

  private mapOrder(row: OrderRecord): OrderRecord {
    return {
      ...row,
      faceValue: Number(row.faceValue),
      salePrice: Number(row.salePrice),
      purchasePrice: Number(row.purchasePrice),
      requestedProductType: row.requestedProductType === 'FAST' ? 'FAST' : 'MIXED',
      refundStatus: this.parseRefundStatus(row.refundStatus),
      monitorStatus: this.parseMonitorStatus(row.monitorStatus),
      channelSnapshotJson: parseJsonValue(row.channelSnapshotJson, {}),
      productSnapshotJson: parseJsonValue(row.productSnapshotJson, {}),
      callbackSnapshotJson: parseJsonValue(row.callbackSnapshotJson, {}),
      supplierRouteSnapshotJson: parseJsonValue(row.supplierRouteSnapshotJson, {}),
      riskSnapshotJson: parseJsonValue(row.riskSnapshotJson, {}),
      extJson: parseJsonValue(row.extJson, {}),
    };
  }

  private mapEvent(row: OrderEventRecord): OrderEventRecord {
    return {
      ...row,
      idempotencyKey: row.idempotencyKey ?? null,
      beforeStatusJson: parseJsonValue(row.beforeStatusJson, {}),
      afterStatusJson: parseJsonValue(row.afterStatusJson, {}),
      payloadJson: parseJsonValue(row.payloadJson, {}),
    };
  }

  private parseRefundStatus(value: unknown): OrderRefundStatus {
    return value === 'PENDING' || value === 'SUCCESS' || value === 'FAIL' ? value : 'NONE';
  }

  private parseMonitorStatus(value: unknown): OrderMonitorStatus {
    return value === 'TIMEOUT_WARNING' ||
      value === 'MANUAL_FOLLOWING' ||
      value === 'LATE_CALLBACK_EXCEPTION'
      ? value
      : 'NORMAL';
  }

  async listOrders(
    filters: OrderListFilters = {},
  ): Promise<{ items: OrderRecord[]; total: number }> {
    const pageNum = filters.pageNum ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const offset = (pageNum - 1) * pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const sortByMap: Record<string, string> = {
      createdAt: 'orders.created_at',
      updatedAt: 'orders.updated_at',
      finishedAt: 'orders.finished_at',
    };
    const orderColumn = sortByMap[filters.sortBy ?? ''] ?? 'orders.created_at';
    const orderDirection = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (filters.keyword?.trim()) {
      params.push(`%${filters.keyword.trim()}%`);
      const index = params.length;
      whereClauses.push(
        `(orders.order_no ILIKE $${index} OR orders.channel_order_no ILIKE $${index} OR orders.mobile_number ILIKE $${index})`,
      );
    }

    const equalityConditions: Array<[string, string | undefined]> = [
      ['orders.order_no', filters.orderNo],
      ['orders.channel_order_no', filters.channelOrderNo],
      ['orders.mobile_number', filters.mobile],
      ['orders.channel_id', filters.channelId],
      ['orders.product_id', filters.productId],
      ['orders.main_status', filters.mainStatus ?? filters.status],
      ['orders.supplier_status', filters.supplierStatus],
      ['orders.notify_status', filters.notifyStatus],
      ['orders.refund_status', filters.refundStatus],
      ['orders.exception_tag', filters.exceptionTag],
    ];

    for (const [column, value] of equalityConditions) {
      if (!value?.trim()) {
        continue;
      }

      params.push(value.trim());
      whereClauses.push(`${column} = $${params.length}`);
    }

    if (filters.startTime) {
      params.push(filters.startTime);
      whereClauses.push(`orders.created_at >= $${params.length}::timestamptz`);
    }

    if (filters.endTime) {
      params.push(filters.endTime);
      whereClauses.push(`orders.created_at <= $${params.length}::timestamptz`);
    }

    if (filters.supplierOrderNo?.trim()) {
      params.push(filters.supplierOrderNo.trim());
      whereClauses.push(
        `EXISTS (
          SELECT 1
          FROM supplier.supplier_orders AS supplier_orders
          WHERE supplier_orders.order_no = orders.order_no
            AND supplier_orders.supplier_order_no = $${params.length}
        )`,
      );
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const baseSelect = `
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        parent_channel_id AS "parentChannelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        payment_status AS "paymentStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        requested_product_type AS "requestedProductType",
        refund_status AS "refundStatus",
        monitor_status AS "monitorStatus",
        channel_snapshot_json AS "channelSnapshotJson",
        product_snapshot_json AS "productSnapshotJson",
        callback_snapshot_json AS "callbackSnapshotJson",
        supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
        risk_snapshot_json AS "riskSnapshotJson",
        ext_json AS "extJson",
        exception_tag AS "exceptionTag",
        remark,
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        warning_deadline_at AS "warningDeadlineAt",
        expire_deadline_at AS "expireDeadlineAt",
        finished_at AS "finishedAt"
      FROM ordering.orders AS orders
      ${whereSql}
    `;
    params.push(pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const rows = await db.unsafe<OrderRecord[]>(
      `${baseSelect}
       ORDER BY ${orderColumn} ${orderDirection}, orders.id DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `SELECT COUNT(*)::int AS total
         FROM ordering.orders AS orders
         ${whereSql}`,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => this.mapOrder(row)),
      total: total?.total ?? 0,
    };
  }

  async findByOrderNo(orderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRecord>(db<OrderRecord[]>`
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        parent_channel_id AS "parentChannelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        payment_status AS "paymentStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        requested_product_type AS "requestedProductType",
        refund_status AS "refundStatus",
        monitor_status AS "monitorStatus",
        channel_snapshot_json AS "channelSnapshotJson",
        product_snapshot_json AS "productSnapshotJson",
        callback_snapshot_json AS "callbackSnapshotJson",
        supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
        risk_snapshot_json AS "riskSnapshotJson",
        ext_json AS "extJson",
        exception_tag AS "exceptionTag",
        remark,
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        warning_deadline_at AS "warningDeadlineAt",
        expire_deadline_at AS "expireDeadlineAt",
        finished_at AS "finishedAt"
      FROM ordering.orders
      WHERE order_no = ${orderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async findByOrderNoAndChannel(channelId: string, orderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRecord>(db<OrderRecord[]>`
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        parent_channel_id AS "parentChannelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        payment_status AS "paymentStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        requested_product_type AS "requestedProductType",
        refund_status AS "refundStatus",
        monitor_status AS "monitorStatus",
        channel_snapshot_json AS "channelSnapshotJson",
        product_snapshot_json AS "productSnapshotJson",
        callback_snapshot_json AS "callbackSnapshotJson",
        supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
        risk_snapshot_json AS "riskSnapshotJson",
        ext_json AS "extJson",
        exception_tag AS "exceptionTag",
        remark,
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        warning_deadline_at AS "warningDeadlineAt",
        expire_deadline_at AS "expireDeadlineAt",
        finished_at AS "finishedAt"
      FROM ordering.orders
      WHERE channel_id = ${channelId}
        AND order_no = ${orderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async findByChannelOrder(channelId: string, channelOrderNo: string): Promise<OrderRecord | null> {
    const row = await first<OrderRecord>(db<OrderRecord[]>`
      SELECT
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        parent_channel_id AS "parentChannelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        payment_status AS "paymentStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        requested_product_type AS "requestedProductType",
        refund_status AS "refundStatus",
        monitor_status AS "monitorStatus",
        channel_snapshot_json AS "channelSnapshotJson",
        product_snapshot_json AS "productSnapshotJson",
        callback_snapshot_json AS "callbackSnapshotJson",
        supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
        risk_snapshot_json AS "riskSnapshotJson",
        ext_json AS "extJson",
        exception_tag AS "exceptionTag",
        remark,
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        warning_deadline_at AS "warningDeadlineAt",
        expire_deadline_at AS "expireDeadlineAt",
        finished_at AS "finishedAt"
      FROM ordering.orders
      WHERE channel_id = ${channelId}
        AND channel_order_no = ${channelOrderNo}
      LIMIT 1
    `);

    return row ? this.mapOrder(row) : null;
  }

  async createOrder(input: {
    channelOrderNo: string;
    channelId: string;
    parentChannelId?: string | null;
    mobile: string;
    province: string;
    ispName: string;
    faceValue: number;
    requestedProductType: RequestedProductType;
    matchedProductId: string;
    salePrice: number;
    purchasePrice: number;
    mainStatus: MainOrderStatus;
    supplierStatus: SupplierOrderStatus;
    notifyStatus: OrderNotifyStatus;
    refundStatus: OrderRefundStatus;
    monitorStatus: OrderMonitorStatus;
    warningDeadlineAt: Date;
    expireDeadlineAt: Date;
    channelSnapshotJson: Record<string, unknown>;
    productSnapshotJson: Record<string, unknown>;
    callbackSnapshotJson: Record<string, unknown>;
    supplierRouteSnapshotJson: Record<string, unknown>;
    riskSnapshotJson: Record<string, unknown>;
    extJson: Record<string, unknown>;
    requestId: string;
  }): Promise<OrderRecord> {
    const orderNo = generateBusinessNo('order');
    const callbackConfig = parseJsonValue<Record<string, unknown>>(
      input.callbackSnapshotJson.callbackConfig,
      {},
    );
    const rows = await db<OrderRecord[]>`
      INSERT INTO ordering.orders (
        id,
        order_no,
        channel_order_no,
        channel_id,
        parent_channel_id,
        product_id,
        mobile_number,
        province_name,
        isp_code,
        face_value,
        sale_price,
        cost_price,
        currency,
        payment_mode,
        main_status,
        payment_status,
        supplier_status,
        notify_status,
        requested_product_type,
        refund_status,
        monitor_status,
        risk_status,
        callback_url,
        warning_deadline_at,
        expire_deadline_at,
        channel_snapshot_json,
        product_snapshot_json,
        callback_snapshot_json,
        supplier_route_snapshot_json,
        risk_snapshot_json,
        exception_tag,
        remark,
        request_id,
        ext_json,
        version,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${orderNo},
        ${input.channelOrderNo},
        ${input.channelId},
        ${input.parentChannelId ?? null},
        ${input.matchedProductId},
        ${input.mobile},
        ${input.province},
        ${input.ispName},
        ${input.faceValue},
        ${input.salePrice},
        ${input.purchasePrice},
        'CNY',
        'BALANCE',
        ${input.mainStatus},
        'PAID',
        ${input.supplierStatus},
        ${input.notifyStatus},
        ${input.requestedProductType},
        ${input.refundStatus},
        ${input.monitorStatus},
        'PASS',
        ${typeof callbackConfig.callbackUrl === 'string' ? callbackConfig.callbackUrl : null},
        ${input.warningDeadlineAt},
        ${input.expireDeadlineAt},
        ${JSON.stringify(input.channelSnapshotJson)},
        ${JSON.stringify(input.productSnapshotJson)},
        ${JSON.stringify(input.callbackSnapshotJson)},
        ${JSON.stringify(input.supplierRouteSnapshotJson)},
        ${JSON.stringify(input.riskSnapshotJson)},
        NULL,
        NULL,
        ${input.requestId},
        ${JSON.stringify(input.extJson)},
        1,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        order_no AS "orderNo",
        channel_order_no AS "channelOrderNo",
        channel_id AS "channelId",
        parent_channel_id AS "parentChannelId",
        mobile_number AS "mobile",
        province_name AS "province",
        isp_code AS "ispName",
        face_value AS "faceValue",
        product_id AS "matchedProductId",
        sale_price AS "salePrice",
        cost_price AS "purchasePrice",
        currency,
        main_status AS "mainStatus",
        payment_status AS "paymentStatus",
        supplier_status AS "supplierStatus",
        notify_status AS "notifyStatus",
        requested_product_type AS "requestedProductType",
        refund_status AS "refundStatus",
        monitor_status AS "monitorStatus",
        channel_snapshot_json AS "channelSnapshotJson",
        product_snapshot_json AS "productSnapshotJson",
        callback_snapshot_json AS "callbackSnapshotJson",
        supplier_route_snapshot_json AS "supplierRouteSnapshotJson",
        risk_snapshot_json AS "riskSnapshotJson",
        ext_json AS "extJson",
        exception_tag AS "exceptionTag",
        remark,
        version,
        request_id AS "requestId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        warning_deadline_at AS "warningDeadlineAt",
        expire_deadline_at AS "expireDeadlineAt",
        finished_at AS "finishedAt"
    `;

    const order = rows[0];

    if (!order) {
      throw new Error('创建订单失败');
    }

    return this.mapOrder(order);
  }

  async updateStatuses(
    orderNo: string,
    update: {
      mainStatus?: MainOrderStatus;
      supplierStatus?: SupplierOrderStatus;
      notifyStatus?: OrderNotifyStatus;
      refundStatus?: OrderRefundStatus;
      monitorStatus?: OrderMonitorStatus;
      exceptionTag?: string | null;
      remark?: string | null;
      finishedAt?: boolean;
    },
  ): Promise<void> {
    const rows = await db<{ orderNo: string }[]>`
      UPDATE ordering.orders
      SET
        main_status = COALESCE(${update.mainStatus ?? null}, main_status),
        supplier_status = COALESCE(${update.supplierStatus ?? null}, supplier_status),
        notify_status = COALESCE(${update.notifyStatus ?? null}, notify_status),
        refund_status = COALESCE(${update.refundStatus ?? null}, refund_status),
        monitor_status = COALESCE(${update.monitorStatus ?? null}, monitor_status),
        exception_tag = COALESCE(${update.exceptionTag ?? null}, exception_tag),
        remark = COALESCE(${update.remark ?? null}, remark),
        finished_at = CASE WHEN ${update.finishedAt ?? false} THEN NOW() ELSE finished_at END,
        version = version + 1,
        updated_at = NOW()
      WHERE order_no = ${orderNo}
      RETURNING order_no AS "orderNo"
    `;

    if (!rows[0]) {
      throw new Error('订单不存在');
    }
  }

  async addEvent(input: {
    orderNo: string;
    eventType: string;
    sourceService: string;
    sourceNo?: string | null;
    beforeStatusJson: Record<string, unknown>;
    afterStatusJson: Record<string, unknown>;
    payloadJson: Record<string, unknown>;
    idempotencyKey: string;
    operator: string;
    requestId: string;
  }): Promise<void> {
    await db`
      INSERT INTO ordering.order_events (
        id,
        order_no,
        event_type,
        source_service,
        source_no,
        before_status_json,
        after_status_json,
        payload_json,
        operator,
        request_id,
        occurred_at
      )
      VALUES (
        ${generateId()},
        ${input.orderNo},
        ${input.eventType},
        ${input.sourceService},
        ${input.sourceNo ?? null},
        ${JSON.stringify(input.beforeStatusJson)},
        ${JSON.stringify(input.afterStatusJson)},
        ${JSON.stringify(input.payloadJson)},
        ${input.operator},
        ${input.requestId},
        NOW()
      )
    `;
  }

  async listEvents(
    orderNo: string,
    filters: OrderEventListFilters = {},
  ): Promise<{ items: OrderEventRecord[]; total: number }> {
    const pageNum = filters.pageNum ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const offset = (pageNum - 1) * pageSize;
    const params: unknown[] = [orderNo];
    const whereClauses = ['order_no = $1'];
    const sortByMap: Record<string, string> = {
      occurredAt: 'occurred_at',
    };
    const orderColumn = sortByMap[filters.sortBy ?? ''] ?? 'occurred_at';
    const orderDirection = filters.sortOrder === 'desc' ? 'DESC' : 'ASC';

    if (filters.startTime) {
      params.push(filters.startTime);
      whereClauses.push(`occurred_at >= $${params.length}::timestamptz`);
    }

    if (filters.endTime) {
      params.push(filters.endTime);
      whereClauses.push(`occurred_at <= $${params.length}::timestamptz`);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    params.push(pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const rows = await db.unsafe<OrderEventRecord[]>(
      `
        SELECT
          id,
          order_no AS "orderNo",
          event_type AS "eventType",
          source_service AS "sourceService",
          source_no AS "sourceNo",
          before_status_json AS "beforeStatusJson",
          after_status_json AS "afterStatusJson",
          payload_json AS "payloadJson",
          operator,
          request_id AS "requestId",
          occurred_at AS "occurredAt"
        FROM ordering.order_events
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id ASC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM ordering.order_events
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items: rows.map((row) => this.mapEvent(row)),
      total: total?.total ?? 0,
    };
  }

  async deleteOrder(orderNo: string): Promise<void> {
    await db.begin(async (tx) => {
      await tx`
        DELETE FROM ordering.order_events
        WHERE order_no = ${orderNo}
      `;
      await tx`
        DELETE FROM ordering.orders
        WHERE order_no = ${orderNo}
      `;
    });
  }

  async addRemark(orderNo: string, remark: string, _operatorUserId: string | null): Promise<void> {
    await this.updateStatuses(orderNo, { remark });
  }

  async transitionTimeoutWarnings(now: Date): Promise<TimeoutWarningTransition[]> {
    const rows = await db<TimeoutWarningTransition[]>`
      WITH eligible AS (
        SELECT
          id,
          order_no AS "orderNo",
          request_id AS "requestId",
          warning_deadline_at::text AS "warningDeadlineAt",
          monitor_status AS "previousMonitorStatus"
        FROM ordering.orders
        WHERE main_status IN ('CREATED', 'PROCESSING')
          AND monitor_status = 'NORMAL'
          AND warning_deadline_at IS NOT NULL
          AND warning_deadline_at <= ${now}
          AND (expire_deadline_at IS NULL OR expire_deadline_at > ${now})
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ordering.orders AS current
      SET
        monitor_status = 'TIMEOUT_WARNING',
        version = current.version + 1,
        updated_at = NOW()
      FROM eligible
      WHERE current.id = eligible.id
      RETURNING
        eligible."orderNo" AS "orderNo",
        eligible."requestId" AS "requestId",
        eligible."warningDeadlineAt" AS "warningDeadlineAt",
        eligible."previousMonitorStatus" AS "previousMonitorStatus"
    `;

    return rows.map((row) => ({
      ...row,
      previousMonitorStatus: this.parseMonitorStatus(row.previousMonitorStatus),
    }));
  }

  async transitionTimeoutExpiry(now: Date): Promise<TimeoutExpiryTransition[]> {
    const rows = await db<TimeoutExpiryTransition[]>`
      WITH eligible AS (
        SELECT
          id,
          order_no AS "orderNo",
          request_id AS "requestId",
          expire_deadline_at::text AS "expireDeadlineAt",
          main_status AS "previousMainStatus",
          supplier_status AS "previousSupplierStatus",
          refund_status AS "previousRefundStatus",
          monitor_status AS "previousMonitorStatus"
        FROM ordering.orders
        WHERE expire_deadline_at IS NOT NULL
          AND expire_deadline_at <= ${now}
          AND (
            (main_status IN ('CREATED', 'PROCESSING') AND refund_status = 'NONE')
            OR (main_status = 'REFUNDING' AND refund_status = 'PENDING')
          )
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ordering.orders AS current
      SET
        main_status = 'REFUNDING',
        supplier_status = 'FAIL',
        refund_status = 'PENDING',
        monitor_status = 'TIMEOUT_WARNING',
        version = current.version + 1,
        updated_at = NOW()
      FROM eligible
      WHERE current.id = eligible.id
      RETURNING
        eligible."orderNo" AS "orderNo",
        eligible."requestId" AS "requestId",
        eligible."expireDeadlineAt" AS "expireDeadlineAt",
        eligible."previousMainStatus" AS "previousMainStatus",
        eligible."previousSupplierStatus" AS "previousSupplierStatus",
        eligible."previousRefundStatus" AS "previousRefundStatus",
        eligible."previousMonitorStatus" AS "previousMonitorStatus"
    `;

    return rows.map((row) => ({
      ...row,
      previousMainStatus:
        row.previousMainStatus === 'PROCESSING' ||
        row.previousMainStatus === 'SUCCESS' ||
        row.previousMainStatus === 'FAIL' ||
        row.previousMainStatus === 'REFUNDING' ||
        row.previousMainStatus === 'REFUNDED' ||
        row.previousMainStatus === 'CLOSED'
          ? row.previousMainStatus
          : 'CREATED',
      previousSupplierStatus:
        row.previousSupplierStatus === 'ACCEPTED' ||
        row.previousSupplierStatus === 'QUERYING' ||
        row.previousSupplierStatus === 'SUCCESS' ||
        row.previousSupplierStatus === 'FAIL'
          ? row.previousSupplierStatus
          : 'WAIT_SUBMIT',
      previousRefundStatus: this.parseRefundStatus(row.previousRefundStatus),
      previousMonitorStatus: this.parseMonitorStatus(row.previousMonitorStatus),
    }));
  }

  async listTimeoutNotificationRecoveryCandidates(now: Date): Promise<OrderRecord[]> {
    const rows = await db<{ orderNo: string }[]>`
      SELECT order_no AS "orderNo"
      FROM ordering.orders
      WHERE main_status = 'REFUNDED'
        AND refund_status = 'SUCCESS'
        AND notify_status IN ('PENDING', 'RETRYING')
        AND expire_deadline_at IS NOT NULL
        AND expire_deadline_at <= ${now}
      ORDER BY updated_at ASC, created_at ASC
    `;

    const orders: OrderRecord[] = [];

    for (const row of rows) {
      const order = await this.findByOrderNo(row.orderNo);

      if (order) {
        orders.push(order);
      }
    }

    return orders;
  }
}
