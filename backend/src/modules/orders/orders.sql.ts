export const ordersSql = {
  listOrders: `
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
    ORDER BY created_at DESC
  `,
  listEvents: `
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
    WHERE order_no = $1
    ORDER BY occurred_at ASC
  `,
} as const;
