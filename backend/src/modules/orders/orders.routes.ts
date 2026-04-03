import { Elysia } from 'elysia';
import type { AuditInput } from '@/lib/audit';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import { stableStringify } from '@/lib/utils';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateOrderBodySchema,
  MarkExceptionBodySchema,
  OrderAdminListQuerySchema,
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
        const openAuth = await channelsService.authenticateOpenRequest({
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
          ordersService.toOpenOrderRecord(
            await ordersService.createOrder({
              channelId: openAuth.channel.id,
              channelOrderNo: body.channelOrderNo,
              mobile: body.mobile,
              faceValue: body.faceValue,
              productType: body.product_type,
              extJson: body.ext ?? {},
              requestId,
              clientIp,
            }),
          ),
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
      '/:orderNo',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const openAuth = await channelsService.authenticateOpenRequest({
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
        const openAuth = await channelsService.authenticateOpenRequest({
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
    );

  const adminRoutes = new Elysia({ prefix: '/admin/orders' })
    .get(
      '/',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        return ok(
          requestId,
          await ordersService.listOrders({
            orderNo: query.orderNo,
            mobile: query.mobile,
            supplierOrderNo: query.supplierOrderNo,
          }),
        );
      },
      {
        query: OrderAdminListQuerySchema,
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
        return ok(requestId, await ordersService.getOrderByNo(params.orderNo));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询后台订单详情',
          description: '后台根据订单号查询订单详情、业务快照和当前处理状态。',
        },
      },
    )
    .get(
      '/:orderNo/events',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        return ok(requestId, await ordersService.listEvents(params.orderNo));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询后台订单事件',
          description: '后台查询订单事件流转记录，用于排查支付、履约和通知过程。',
        },
      },
    )
    .post(
      '/:orderNo/close',
      async ({ params, request }) => {
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
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
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
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
        body: MarkExceptionBodySchema,
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

        return ok(requestId, { success: true });
      },
      {
        body: RemarkBodySchema,
        detail: {
          tags: ['admin'],
          summary: '追加订单备注',
          description: '后台为订单追加人工备注，记录排查结论和处理说明。',
        },
      },
    )
    .post(
      '/:orderNo/retry-notify',
      async ({ params, request }) => {
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
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['admin'],
          summary: '重试订单通知',
          description: '后台手工触发订单结果通知重试，用于补偿回调失败场景。',
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
