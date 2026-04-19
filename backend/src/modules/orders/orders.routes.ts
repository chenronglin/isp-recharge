import { Elysia } from 'elysia';
import type { AuditInput } from '@/lib/audit';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import {
  buildOperationResult,
  buildPageResult,
  createPageResponseSchema,
  createSuccessResponseSchema,
  ok,
  OperationResultSchema,
  parseOptionalDateTime,
  parsePagination,
  parseSort,
} from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import { stableStringify } from '@/lib/utils';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  ActionReasonBodySchema,
  AdminOrderDetailSchema,
  AdminOrderEventSchema,
  AdminOrderListItemSchema,
  BatchImportBodySchema,
  BatchOrdersBodySchema,
  CreateOrderBodySchema,
  MarkExceptionBodySchema,
  ManualStatusBodySchema,
  OrderEventsQuerySchema,
  OrderAdminListQuerySchema,
  OpenOrdersListQuerySchema,
  PreviewSplitBodySchema,
  RemarkBodySchema,
} from '@/modules/orders/orders.schema';
import type { OrdersService } from '@/modules/orders/orders.service';

interface OrdersRoutesDeps {
  ordersService: OrdersService;
  channelsService: ChannelsService;
  iamService: IamService;
  auditLogger?: (input: AuditInput) => Promise<void>;
}

export function createOrdersRoutes({
  ordersService,
  channelsService,
  iamService,
  auditLogger = async () => {},
}: OrdersRoutesDeps) {
  const openRoutes = new Elysia({ prefix: '/open-api/orders' })
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: stableStringify(body),
        });
        const created = await ordersService.createOrder({
          channelId: openAuth.channel.id,
          channelOrderNo: body.channelOrderNo,
          mobile: body.mobile,
          faceValue: body.faceValue,
          productType: body.product_type,
          extJson: body.ext ?? {},
          requestId,
          clientIp,
        });

        return ok(
          requestId,
          await ordersService.getOpenOrderByNoForChannel(openAuth.channel.id, created.orderNo),
        );
      },
      {
        body: CreateOrderBodySchema,
        detail: {
          tags: ['open-api'],
          summary: '创建充值订单',
          description: '渠道侧使用手机号、面值与充值类型创建 ISP 充值订单。',
        },
      },
    )
    .get(
      '/',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await ordersService.listOpenOrders({
          channelId: openAuth.channel.id,
          pageNum,
          pageSize,
          orderNo: typeof query.orderNo === 'string' ? query.orderNo : undefined,
          channelOrderNo:
            typeof query.channelOrderNo === 'string' ? query.channelOrderNo : undefined,
          mobile: typeof query.mobile === 'string' ? query.mobile : undefined,
          mainStatus: typeof query.mainStatus === 'string' ? query.mainStatus : undefined,
          supplierStatus:
            typeof query.supplierStatus === 'string' ? query.supplierStatus : undefined,
          refundStatus: typeof query.refundStatus === 'string' ? query.refundStatus : undefined,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
        });

        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: OpenOrdersListQuerySchema,
        detail: {
          tags: ['open-api'],
          summary: '查询门户订单列表',
          description: '渠道门户或签名调用查询当前渠道下的父订单列表。',
        },
      },
    )
    .post(
      '/preview-split',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: stableStringify(body),
        });

        return ok(
          requestId,
          await ordersService.previewSplit({
            channelId: openAuth.channel.id,
            mobile: body.mobile,
            faceValue: body.faceValue,
            productType: body.productType,
          }),
        );
      },
      {
        body: PreviewSplitBodySchema,
        detail: {
          tags: ['open-api'],
          summary: '预览拆单结果',
          description: '渠道门户预览指定手机号和面值的拆单组合与命中供应商。',
        },
      },
    )
    .post(
      '/batch',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: stableStringify(body),
        });

        return ok(
          requestId,
          await ordersService.createBatchOrders({
            channelId: openAuth.channel.id,
            orders: body.orders,
            requestId,
            clientIp: getClientIpFromRequest(request),
          }),
        );
      },
      {
        body: BatchOrdersBodySchema,
        detail: {
          tags: ['open-api'],
          summary: '批量创建订单',
          description: '渠道门户按结构化明细批量创建订单，并落统一 Worker 任务结果。',
        },
      },
    )
    .post(
      '/batch-import',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: stableStringify(body),
        });

        return ok(
          requestId,
          await ordersService.createBatchImportJob({
            channelId: openAuth.channel.id,
            content: body.content,
            requestId,
            clientIp: getClientIpFromRequest(request),
          }),
        );
      },
      {
        body: BatchImportBodySchema,
        detail: {
          tags: ['open-api'],
          summary: '导入批量订单',
          description: '渠道门户通过文本导入批量订单，并生成逐项结果任务。',
        },
      },
    )
    .get(
      '/batch-template',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, ordersService.getBatchTemplate());
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '获取批量模板',
          description: '渠道门户获取批量下单模板示例。',
        },
      },
    )
    .get(
      '/batch-jobs/:jobId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.getJobById(params.jobId));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询批量任务详情',
          description: '渠道门户查询批量创建或导入任务的执行详情。',
        },
      },
    )
    .get(
      '/batch-jobs/:jobId/items',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.getJobItems(params.jobId));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询批量任务明细项',
          description: '渠道门户查询批量任务的逐项处理结果。',
        },
      },
    )
    .get(
      '/customers',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.listCustomers(openAuth.channel.id));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询客户列表',
          description: '渠道门户按手机号聚合查询当前渠道的客户中心数据。',
        },
      },
    )
    .get(
      '/customers/:mobile',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(
          requestId,
          await ordersService.getCustomerDetail(openAuth.channel.id, params.mobile),
        );
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询客户详情',
          description: '渠道门户查询指定手机号的聚合订单视图。',
        },
      },
    )
    .post(
      '/customers/export',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.exportCustomers(openAuth.channel.id));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '导出客户',
          description: '渠道门户导出客户列表，结果写入 Worker artifact。',
        },
      },
    )
    .post(
      '/export',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.exportOrders(openAuth.channel.id));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '导出订单',
          description: '渠道门户导出订单列表，结果写入 Worker artifact。',
        },
      },
    )
    .post(
      '/logs/export',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.exportLogs(openAuth.channel.id));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '导出日志',
          description: '渠道门户导出订单日志摘要，结果写入 Worker artifact。',
        },
      },
    )
    .get(
      '/jobs/:jobId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });

        return ok(requestId, await ordersService.getJobById(params.jobId));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询任务',
          description: '渠道门户查询导出或批量任务详情。',
        },
      },
    )
    .get(
      '/:orderNo',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });
        return ok(
          requestId,
          await ordersService.getOpenOrderByNoForChannel(openAuth.channel.id, params.orderNo),
        );
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询充值订单详情',
          description: '渠道侧根据平台订单号查询订单当前主状态、支付状态和履约状态。',
        },
      },
    )
    .get(
      '/:orderNo/events',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });
        return ok(
          requestId,
          await ordersService.listOpenEventsForChannel(openAuth.channel.id, params.orderNo),
        );
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询充值订单轨迹',
          description: '渠道侧查询订单生命周期事件轨迹，便于联调和状态排查。',
        },
      },
    )
    .post(
      '/:orderNo/refresh-status',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.resolveChannelAuthContext({
          authorization: request.headers.get('authorization'),
          accessKey: request.headers.get('AccessKey') ?? '',
          signature: request.headers.get('Sign') ?? '',
          timestamp: request.headers.get('Timestamp') ?? '',
          nonce: request.headers.get('Nonce') ?? '',
          method: request.method,
          path: new URL(request.url).pathname,
          bodyText: '',
        });
        await ordersService.getOpenOrderByNoForChannel(openAuth.channel.id, params.orderNo);
        return ok(requestId, await ordersService.refreshOrderStatus(params.orderNo));
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '刷新订单状态',
          description: '渠道门户对父订单触发主动查单。',
        },
      },
    );

  const adminRoutes = new Elysia({ prefix: '/admin/orders' })
    .get(
      '/',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortBy, sortOrder } = parseSort(
          query as Record<string, unknown>,
          'createdAt',
          'desc',
        );
        const result = await ordersService.listOrders({
          pageNum,
          pageSize,
          keyword: query.keyword,
          status: query.status,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
          sortBy,
          sortOrder,
          orderNo: query.orderNo,
          channelOrderNo: query.channelOrderNo,
          mobile: query.mobile,
          channelId: query.channelId,
          productId: query.productId,
          mainStatus: query.mainStatus,
          supplierStatus: query.supplierStatus,
          notifyStatus: query.notifyStatus,
          refundStatus: query.refundStatus,
          exceptionTag: query.exceptionTag,
          supplierOrderNo: query.supplierOrderNo,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: OrderAdminListQuerySchema,
        response: createPageResponseSchema(AdminOrderListItemSchema),
        detail: {
          tags: ['admin'],
          summary: '查询后台订单列表',
          description: '后台查询订单列表，查看支付、履约、通知和异常状态。',
        },
      },
    )
    .get(
      '/:orderNo',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        return ok(requestId, await ordersService.getAdminOrderDetail(params.orderNo));
      },
      {
        response: createSuccessResponseSchema(AdminOrderDetailSchema),
        detail: {
          tags: ['admin'],
          summary: '查询后台订单详情',
          description: '后台根据订单号查询订单详情、业务快照和当前处理状态。',
        },
      },
    )
    .get(
      '/:orderNo/events',
      async ({ params, query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortBy, sortOrder } = parseSort(
          query as Record<string, unknown>,
          'occurredAt',
          'asc',
        );
        const result = await ordersService.listEvents(params.orderNo, {
          pageNum,
          pageSize,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: OrderEventsQuerySchema,
        response: createPageResponseSchema(AdminOrderEventSchema),
        detail: {
          tags: ['admin'],
          summary: '查询后台订单事件',
          description: '后台查询订单事件流转记录，用于排查支付、履约和通知过程。',
        },
      },
    )
    .post(
      '/:orderNo/close',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await ordersService.closeOrder(params.orderNo, requestId);

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CLOSE_ORDER',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: {
            orderNo: params.orderNo,
            reason: body.reason,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.orderNo,
            resourceType: 'ORDER',
            status: 'CLOSED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.reason,
          }),
        );
      },
      {
        body: ActionReasonBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '关闭订单',
          description: '后台手工关闭指定订单，用于终止异常或不再继续处理的订单。',
        },
      },
    )
    .post(
      '/:orderNo/mark-exception',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await ordersService.markException(params.orderNo, body.exceptionTag, requestId);

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'MARK_ORDER_EXCEPTION',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: {
            orderNo: params.orderNo,
            exceptionTag: body.exceptionTag,
            reason: body.reason,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.orderNo,
            resourceType: 'ORDER',
            status: 'EXCEPTION_MARKED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.reason,
          }),
        );
      },
      {
        body: MarkExceptionBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '标记订单异常',
          description: '后台为订单添加异常标签，便于运营识别和后续人工处理。',
        },
      },
    )
    .post(
      '/:orderNo/remarks',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        await ordersService.addRemark(params.orderNo, body.remark, admin.userId);

        await auditLogger({
          operatorUserId: admin.userId,
          operatorUsername: admin.username,
          action: 'ADD_ORDER_REMARK',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: {
            orderNo: params.orderNo,
            remark: body.remark,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.orderNo,
            resourceType: 'ORDER',
            status: 'REMARK_ADDED',
            operator: {
              userId: admin.userId,
              username: admin.username,
              displayName: admin.displayName,
            },
            remark: body.remark,
          }),
        );
      },
      {
        body: RemarkBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '追加订单备注',
          description: '后台为订单追加人工备注，记录排查结论和处理说明。',
        },
      },
    )
    .post(
      '/:orderNo/retry-notify',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS', 'SUPPORT']);
        await ordersService.retryNotification(params.orderNo);

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RETRY_ORDER_NOTIFICATION',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: {
            orderNo: params.orderNo,
            reason: body.reason,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.orderNo,
            resourceType: 'ORDER',
            status: 'NOTIFICATION_RETRY_REQUESTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.reason,
          }),
        );
      },
      {
        body: ActionReasonBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '重试订单通知',
          description: '后台手工触发订单结果通知重试，用于补偿回调失败场景。',
        },
      },
    )
    .post(
      '/:orderNo/refresh-status',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS', 'SUPPORT']);
        const result = await ordersService.refreshOrderStatus(params.orderNo);

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'REFRESH_ORDER_STATUS',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: result,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, result);
      },
      {
        detail: {
          tags: ['admin'],
          summary: '手工刷新订单状态',
          description: '后台对父订单下的所有可查子单触发主动查单。',
        },
      },
    )
    .post(
      '/:orderNo/retry-recharge',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const result = await ordersService.retryRecharge(params.orderNo);

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RETRY_ORDER_RECHARGE',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: result,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, result);
      },
      {
        detail: {
          tags: ['admin'],
          summary: '重提失败子单',
          description: '后台对父订单下的失败或未成功子单重新发起供应商提单。',
        },
      },
    )
    .post(
      '/:orderNo/manual-status',
      async ({ body, params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await ordersService.manualUpdateStatus({
          orderNo: params.orderNo,
          mainStatus: body.mainStatus,
          supplierStatus: body.supplierStatus,
          refundStatus: body.refundStatus,
          remark: body.remark,
          requestId,
        });

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'MANUAL_UPDATE_ORDER_STATUS',
          resourceType: 'ORDER',
          resourceId: params.orderNo,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.orderNo,
            resourceType: 'ORDER',
            status: body.mainStatus,
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.remark,
          }),
        );
      },
      {
        body: ManualStatusBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '人工改态',
          description: '后台直接改写父订单及其子单状态，用于早期人工兜底。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/orders' })
    .post(
      '/:orderNo/supplier-events',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        const payloadBody = body as Record<string, any>;

        if (payloadBody.status === 'ACCEPTED' || payloadBody.status === 'PROCESSING') {
          await ordersService.handleSupplierAccepted({
            orderNo: params.orderNo,
            supplierId: String(payloadBody.supplierId),
            supplierOrderNo: String(payloadBody.supplierOrderNo),
            status: payloadBody.status,
          });
        } else if (payloadBody.status === 'SUCCESS') {
          await ordersService.handleSupplierSucceeded({
            orderNo: params.orderNo,
            supplierId: String(payloadBody.supplierId),
            supplierOrderNo: String(payloadBody.supplierOrderNo),
            costPrice: Number(payloadBody.costPrice ?? 0),
          });
        } else {
          await ordersService.handleSupplierFailed({
            orderNo: params.orderNo,
            supplierId: String(payloadBody.supplierId),
            supplierOrderNo: String(payloadBody.supplierOrderNo),
            reason: String(payloadBody.reason ?? '供应商失败'),
          });
        }

        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['internal'],
          summary: '写入供应商履约事件',
          description: '内部服务将供应商受理、成功或失败事件回写到订单域，推进订单状态流转。',
        },
      },
    )
    .post(
      '/:orderNo/notification-events',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        const payloadBody = body as Record<string, any>;

        if (payloadBody.status === 'SUCCESS') {
          await ordersService.handleNotificationSucceeded({
            orderNo: params.orderNo,
            taskNo: String(payloadBody.taskNo),
          });
        } else {
          await ordersService.handleNotificationFailed({
            orderNo: params.orderNo,
            taskNo: String(payloadBody.taskNo),
            reason: String(payloadBody.reason ?? '通知失败'),
          });
        }

        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['internal'],
          summary: '写入通知投递事件',
          description: '内部服务将通知成功或失败结果回写到订单域，用于维护通知状态。',
        },
      },
    );

  return new Elysia().use(openRoutes).use(adminRoutes).use(internalRoutes);
}
