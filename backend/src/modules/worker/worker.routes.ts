import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, ok, parsePagination } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import { EnqueueJobBodySchema } from '@/modules/worker/worker.schema';
import type { WorkerService } from '@/modules/worker/worker.service';

interface WorkerRoutesDeps {
  workerService: WorkerService;
  iamService: IamService;
}

export function createWorkerRoutes({ workerService, iamService }: WorkerRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/jobs' })
    .get(
      '/',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);

        const { page, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await workerService.list(page, pageSize);

        return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询异步任务列表',
          description: '后台分页查询 Worker 任务队列，查看任务状态、类型和调度时间。',
        },
      },
    )
    .get(
      '/:jobId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);

        return ok(requestId, await workerService.getById(params.jobId));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询异步任务详情',
          description: '后台按任务编号查询 Worker 任务详情、载荷和执行状态。',
        },
      },
    )
    .post(
      '/:jobId/retry',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await workerService.retry(params.jobId);
        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['admin'],
          summary: '重试异步任务',
          description: '后台手工重试指定 Worker 任务，常用于失败任务补偿。',
        },
      },
    )
    .post(
      '/:jobId/cancel',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await workerService.cancel(params.jobId);
        return ok(requestId, { success: true });
      },
      {
        detail: {
          tags: ['admin'],
          summary: '取消异步任务',
          description: '后台取消指定 Worker 任务，阻止未执行任务继续进入处理流程。',
        },
      },
    )
    .get(
      '/dead-letters',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await workerService.listDeadLetters());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询任务死信列表',
          description: '后台查询多次失败后进入死信队列的 Worker 任务记录。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/jobs' })
    .post(
      '/enqueue',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));

        const job = await workerService.enqueue({
          jobType: body.jobType,
          businessKey: body.businessKey,
          payload: body.payload,
          maxAttempts: body.maxAttempts,
        });

        return ok(requestId, job);
      },
      {
        body: EnqueueJobBodySchema,
        detail: {
          tags: ['internal'],
          summary: '立即入队异步任务',
          description: '内部服务立即创建并入队 Worker 任务，供调度器尽快执行。',
        },
      },
    )
    .post(
      '/schedule',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));

        const delaySeconds = body.delaySeconds ?? 0;
        const job = await workerService.schedule({
          jobType: body.jobType,
          businessKey: body.businessKey,
          payload: body.payload,
          maxAttempts: body.maxAttempts,
          nextRunAt: new Date(Date.now() + delaySeconds * 1000),
        });

        return ok(requestId, job);
      },
      {
        body: EnqueueJobBodySchema,
        detail: {
          tags: ['internal'],
          summary: '延迟调度异步任务',
          description: '内部服务创建带延迟执行时间的 Worker 任务，用于重试和延时处理。',
        },
      },
    );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
