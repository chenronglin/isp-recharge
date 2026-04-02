import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
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
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await notificationsService.listTasks());
      },
      {
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
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await notificationsService.getTask(params.taskNo));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询通知任务详情',
          description: '后台根据任务编号查询通知任务详情和最近一次投递结果。',
        },
      },
    )
    .post(
      '/tasks/:taskNo/retry',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await notificationsService.retryTask(params.taskNo);
        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['admin'],
          summary: '重试通知任务',
          description: '后台手工重试指定通知任务，用于补偿失败或卡住的回调投递。',
        },
      },
    )
    .get(
      '/dead-letters',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await notificationsService.listDeadLetters());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询通知死信列表',
          description: '后台查询达到最大重试次数后进入死信队列的通知任务记录。',
        },
      },
    );

  return new Elysia().use(adminRoutes);
}
