import { Elysia, t } from 'elysia';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, createPageResponseSchema, createSuccessResponseSchema, ok, parsePagination } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  EnqueueJobBodySchema,
  WorkerJobArtifactSchema,
  WorkerJobDetailSchema,
  WorkerJobItemSchema,
  WorkerJobSchema,
} from '@/modules/worker/worker.schema';
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
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);

        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await workerService.list(pageNum, pageSize);

        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        response: createPageResponseSchema(WorkerJobSchema),
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
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);

        return ok(requestId, await workerService.getById(params.jobId));
      },
      {
        response: createSuccessResponseSchema(WorkerJobDetailSchema),
        detail: {
          tags: ['admin'],
          summary: '查询异步任务详情',
          description: '后台按任务编号查询 Worker 任务详情、载荷和执行状态。',
        },
      },
    )
    .get(
      '/:jobId/items',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);

        return ok(requestId, await workerService.listJobItems(params.jobId));
      },
      {
        response: createSuccessResponseSchema(t.Array(WorkerJobItemSchema)),
        detail: {
          tags: ['admin'],
          summary: '查询任务明细项',
          description: '后台按任务编号查询批量任务逐项处理结果。',
        },
      },
    )
    .get(
      '/:jobId/artifacts',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);

        return ok(requestId, await workerService.listJobArtifacts(params.jobId));
      },
      {
        response: createSuccessResponseSchema(t.Array(WorkerJobArtifactSchema)),
        detail: {
          tags: ['admin'],
          summary: '查询任务产物',
          description: '后台查询任务生成的导出文件或回执文件信息。',
        },
      },
    )
    .post(
      '/:jobId/retry',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS', 'SUPPORT']);
        await workerService.retry(params.jobId);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RETRY_WORKER_JOB',
          resourceType: 'WORKER_JOB',
          resourceId: params.jobId,
          details: {
            jobId: params.jobId,
          },
          requestId,
          ip: clientIp,
        });

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
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS', 'SUPPORT']);
        await workerService.cancel(params.jobId);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CANCEL_WORKER_JOB',
          resourceType: 'WORKER_JOB',
          resourceId: params.jobId,
          details: {
            jobId: params.jobId,
          },
          requestId,
          ip: clientIp,
        });

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
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS', 'SUPPORT']);
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
