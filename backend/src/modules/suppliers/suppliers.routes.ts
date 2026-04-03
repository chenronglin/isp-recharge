import { Elysia } from 'elysia';
import type { AuditInput } from '@/lib/audit';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  SupplierCatalogDeltaSyncBodySchema,
  SupplierCatalogFullSyncBodySchema,
  CreateSupplierConfigBodySchema,
  SupplierReconcileBodySchema,
  SupplierQueryBodySchema,
  SupplierSubmitBodySchema,
} from '@/modules/suppliers/suppliers.schema';
import type { SuppliersService } from '@/modules/suppliers/suppliers.service';

interface SuppliersRoutesDeps {
  suppliersService: SuppliersService;
  iamService: IamService;
  auditLogger?: (input: AuditInput) => Promise<void>;
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

export function createSuppliersRoutes({
  suppliersService,
  iamService,
  auditLogger = async () => {},
}: SuppliersRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/suppliers',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS']);
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
    .get(
      '/admin/suppliers/reconcile-diffs',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(
          requestId,
          await suppliersService.listReconcileDiffs({
            reconcileDate:
              typeof query.reconcileDate === 'string' ? query.reconcileDate : undefined,
            orderNo: typeof query.orderNo === 'string' ? query.orderNo : undefined,
          }),
        );
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询供应商对账差异',
          description: '后台查询供应商订单差异明细，支持按对账日期或订单号过滤。',
        },
      },
    )
    .get(
      '/admin/suppliers/:supplierId/balance',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS']);
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
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const result = await suppliersService.triggerCatalogSync({ supplierId: params.supplierId });

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'TRIGGER_SUPPLIER_CATALOG_SYNC',
          resourceType: 'SUPPLIER',
          resourceId: params.supplierId,
          details: {
            supplierId: params.supplierId,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          result,
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
    .post(
      '/admin/suppliers/:supplierId/recover-circuit-breaker',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const result = await suppliersService.recoverCircuitBreaker({
          supplierId: params.supplierId,
        });

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RECOVER_SUPPLIER_CIRCUIT_BREAKER',
          resourceType: 'SUPPLIER',
          resourceId: params.supplierId,
          details: {
            supplierId: params.supplierId,
            breakerStatus: result.breakerStatus,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, result);
      },
      {
        detail: {
          tags: ['admin'],
          summary: '人工恢复供应商熔断',
          description: '后台人工解除供应商运行时熔断状态，使其重新参与自动路由。',
        },
      },
    )
    .get(
      '/admin/suppliers/:supplierId/sync-logs',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(
          requestId,
          await suppliersService.listSyncLogs({ supplierId: params.supplierId }),
        );
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
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await suppliersService.upsertConfig({
          ...body,
          timeoutMs: body.timeoutMs ?? 2000,
        });

        await auditLogger({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_SUPPLIER_CONFIG',
          resourceType: 'SUPPLIER_CONFIG',
          resourceId: body.supplierId,
          details: {
            supplierId: body.supplierId,
            configJson: body.configJson,
            timeoutMs: body.timeoutMs ?? 2000,
          },
          requestId,
          ip: clientIp,
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

  const internalOrderRoutes = new Elysia({ prefix: '/internal/suppliers/orders' })
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

  const internalCatalogRoutes = new Elysia({ prefix: '/internal/suppliers/catalog' })
    .post(
      '/full-sync',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleCatalogFullSyncJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierCatalogFullSyncBodySchema,
        detail: {
          tags: ['internal'],
          summary: '执行供应商全量目录同步',
          description: '内部服务触发供应商全量目录同步任务，刷新平台映射基线。',
        },
      },
    )
    .post(
      '/delta-sync',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        await suppliersService.handleCatalogDeltaSyncJob(body as Record<string, unknown>);
        return ok(requestId, { success: true });
      },
      {
        body: SupplierCatalogDeltaSyncBodySchema,
        detail: {
          tags: ['internal'],
          summary: '执行供应商动态目录同步',
          description: '内部服务触发供应商动态库存与价格同步任务。',
        },
      },
    );

  const internalReconcileRoutes = new Elysia({ prefix: '/internal/suppliers/reconcile' }).post(
    '/orders',
    async ({ body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      await suppliersService.handleReconcileJob(body as Record<string, unknown>);
      return ok(requestId, { success: true });
    },
    {
      body: SupplierReconcileBodySchema,
      detail: {
        tags: ['internal'],
        summary: '执行供应商订单对账',
        description: '内部服务触发在途差异扫描或日对账，输出对账差异结果。',
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

  return new Elysia()
    .use(adminRoutes)
    .use(internalOrderRoutes)
    .use(internalCatalogRoutes)
    .use(internalReconcileRoutes)
    .use(callbackRoutes);
}
