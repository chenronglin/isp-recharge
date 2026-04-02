import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateSupplierBodySchema,
  CreateSupplierConfigBodySchema,
  SupplierQueryBodySchema,
  SupplierSubmitBodySchema,
} from '@/modules/suppliers/suppliers.schema';
import type { SuppliersService } from '@/modules/suppliers/suppliers.service';

interface SuppliersRoutesDeps {
  suppliersService: SuppliersService;
  iamService: IamService;
}

function getHeadersJson(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function parseCallbackBody(rawBody: string, contentType: string): Record<string, unknown> {
  const normalizedContentType = contentType.toLowerCase();

  if (normalizedContentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  if (!rawBody.trim()) {
    return {};
  }

  if (normalizedContentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw badRequest('回调 JSON 解析失败');
    }
  }

  return {};
}

export function createSuppliersRoutes({ suppliersService, iamService }: SuppliersRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/suppliers',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.listSuppliers());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询供应商列表',
          description: '后台查询供应商基础资料、协议类型与启用状态信息。',
        },
      },
    )
    .post(
      '/admin/suppliers',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.createSupplier(body));
      },
      {
        body: CreateSupplierBodySchema,
        detail: {
          tags: ['admin'],
          summary: '创建供应商',
          description: '后台新增供应商主体资料，为商品映射与履约链路配置供应商。',
        },
      },
    )
    .get(
      '/admin/suppliers/:supplierId/balance',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(
          requestId,
          await suppliersService.getSupplierBalance({ supplierId: params.supplierId }),
        );
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询供应商余额',
          description: '后台查询供应商账户余额与收益信息，用于运维巡检和额度预警。',
        },
      },
    )
    .post(
      '/admin/suppliers/:supplierId/catalog/sync',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(
          requestId,
          await suppliersService.triggerCatalogSync({ supplierId: params.supplierId }),
        );
      },
      {
        detail: {
          tags: ['admin'],
          summary: '手工触发目录同步',
          description: '后台手工触发供应商全量目录同步，刷新商品映射与库存状态。',
        },
      },
    )
    .get(
      '/admin/suppliers/:supplierId/sync-logs',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await suppliersService.listSyncLogs({ supplierId: params.supplierId }));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询目录同步日志',
          description: '后台查询供应商目录同步日志，查看最近同步状态、请求响应与失败原因。',
        },
      },
    )
    .post(
      '/admin/supplier-configs',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        await suppliersService.upsertConfig({
          ...body,
          timeoutMs: body.timeoutMs ?? 2000,
        });
        return ok(requestId, { success: true });
      },
      {
        body: CreateSupplierConfigBodySchema,
        detail: {
          tags: ['admin'],
          summary: '配置供应商参数',
          description: '后台维护供应商凭证、回调密钥和超时策略等履约参数。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/suppliers/orders' })
    .post(
      '/submit',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleSupplierSubmitJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierSubmitBodySchema,
        detail: {
          tags: ['internal'],
          summary: '执行供应商提单任务',
          description: '内部 Worker 调用供应商模块执行订单提单，并记录请求响应结果。',
        },
      },
    )
    .post(
      '/query',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleSupplierQueryJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierQueryBodySchema,
        detail: {
          tags: ['internal'],
          summary: '执行供应商查询任务',
          description: '内部 Worker 调用供应商模块查询订单履约状态，并推进订单状态机。',
        },
      },
    );

  const callbackRoutes = new Elysia({ prefix: '/callbacks/suppliers' }).post(
    '/:supplierCode',
    async ({ params, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const contentType = request.headers.get('content-type') ?? '';
      const rawBody = await request.text();
      const parsedBody = parseCallbackBody(rawBody, contentType);
      await suppliersService.handleSupplierCallback(params.supplierCode, {
        headers: getHeadersJson(request.headers),
        body: parsedBody,
        rawBody,
        contentType,
      });

      if (params.supplierCode === 'shenzhen-kefei') {
        return new Response('OK', {
          status: 200,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
          },
        });
      }

      return ok(requestId, { success: true });
    },
    {
      detail: {
        tags: ['callbacks'],
        summary: '接收供应商回调',
        description: '接收外部供应商的异步状态回调，完成签名校验、记录和订单状态推进。',
      },
    },
  );

  return new Elysia().use(adminRoutes).use(internalRoutes).use(callbackRoutes);
}
