import { Elysia } from 'elysia';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader } from '@/lib/auth';
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
import type { IamService } from '@/modules/iam/iam.service';
import {
  NotificationDeadLetterListQuerySchema,
  NotificationDeadLetterSchema,
  NotificationDeliveryLogsQuerySchema,
  NotificationDeliveryLogSchema,
  NotificationsTaskListQuerySchema,
  NotificationTaskDetailSchema,
  NotificationTaskSchema,
  RetryNotificationTaskBodySchema,
} from '@/modules/notifications/notifications.schema';
import type { NotificationsService } from '@/modules/notifications/notifications.service';

interface NotificationsRoutesDeps {
  notificationsService: NotificationsService;
  iamService: IamService;
}

export function createNotificationsRoutes({
  notificationsService,
  iamService,
}: NotificationsRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/notifications' })
    .get(
      '/tasks',
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
        const result = await notificationsService.listTasks({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          status: typeof query.status === 'string' ? query.status : undefined,
          taskNo: typeof query.taskNo === 'string' ? query.taskNo : undefined,
          bizNo: typeof query.bizNo === 'string' ? query.bizNo : undefined,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: NotificationsTaskListQuerySchema,
        response: createPageResponseSchema(NotificationTaskSchema),
        detail: {
          tags: ['admin'],
          summary: '查询通知任务列表',
          description: '后台查询订单结果通知任务的状态、投递次数和目标地址。',
        },
      },
    )
    .get(
      '/tasks/:taskNo',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        return ok(requestId, await notificationsService.getTaskDetail(params.taskNo));
      },
      {
        response: createSuccessResponseSchema(NotificationTaskDetailSchema),
        detail: {
          tags: ['admin'],
          summary: '查询通知任务详情',
          description: '后台根据任务编号查询通知任务详情和最近一次投递结果。',
        },
      },
    )
    .post(
      '/tasks/:taskNo/retry',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS', 'SUPPORT']);
        await notificationsService.retryTask(params.taskNo);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RETRY_NOTIFICATION_TASK',
          resourceType: 'NOTIFICATION_TASK',
          resourceId: params.taskNo,
          details: {
            taskNo: params.taskNo,
            reason: body.reason,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.taskNo,
            resourceType: 'NOTIFICATION_TASK',
            status: 'RETRY_REQUESTED',
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
        body: RetryNotificationTaskBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '重试通知任务',
          description: '后台手工重试指定通知任务，用于补偿失败或卡住的回调投递。',
        },
      },
    )
    .get(
      '/tasks/:taskNo/delivery-logs',
      async ({ params, query, request }) => {
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
        const result = await notificationsService.listDeliveryLogs({
          taskNo: params.taskNo,
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
        query: NotificationDeliveryLogsQuerySchema,
        response: createPageResponseSchema(NotificationDeliveryLogSchema),
        detail: {
          tags: ['admin'],
          summary: '查询通知投递日志',
          description: '后台分页查询指定通知任务的投递日志，查看请求载荷、响应状态和响应体。',
        },
      },
    )
    .get(
      '/dead-letters',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortOrder } = parseSort(query as Record<string, unknown>, 'createdAt', 'desc');
        const result = await notificationsService.listDeadLetters({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: NotificationDeadLetterListQuerySchema,
        response: createPageResponseSchema(NotificationDeadLetterSchema),
        detail: {
          tags: ['admin'],
          summary: '查询通知死信列表',
          description: '后台查询达到最大重试次数后进入死信队列的通知任务记录。',
        },
      },
    );

  return new Elysia().use(adminRoutes);
}
