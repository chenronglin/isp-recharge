import { Elysia, t } from 'elysia';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import {
  buildOperationResult,
  buildPageResult,
  createPageResponseSchema,
  createSuccessResponseSchema,
  ok,
  OperationResultSchema,
  parsePagination,
  parseSort,
} from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  AdminProductsQuerySchema,
  AdminRechargeProductSchema,
  ProductIdParamsSchema,
  RechargeProductTypeSchema,
  SaveRechargeProductBodySchema,
} from '@/modules/products/products.schema';
import type { ProductsService } from '@/modules/products/products.service';

interface ProductsRoutesDeps {
  productsService: ProductsService;
  iamService: IamService;
  channelsService: ChannelsService;
}

export function createProductsRoutes({
  productsService,
  iamService,
  channelsService,
}: ProductsRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/products',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortBy, sortOrder } = parseSort(
          query as Record<string, unknown>,
          'productCode',
          'asc',
        );
        const result = await productsService.listAdminProducts({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          status: typeof query.status === 'string' ? query.status : undefined,
          carrierCode: typeof query.carrierCode === 'string' ? query.carrierCode : undefined,
          productType: typeof query.productType === 'string' ? query.productType : undefined,
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: AdminProductsQuerySchema,
        response: createPageResponseSchema(AdminRechargeProductSchema),
        detail: {
          tags: ['admin'],
          summary: '列出充值商品',
          description: '后台查看平台维护的全部充值商品主数据，含启用与停用状态。',
        },
      },
    )
    .get(
      '/admin/products/:productId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await productsService.getAdminProductById(params.productId));
      },
      {
        params: ProductIdParamsSchema,
        response: createSuccessResponseSchema(AdminRechargeProductSchema),
        detail: {
          tags: ['admin'],
          summary: '查询平台商品详情',
          description: '后台根据商品编号查询平台商品详情，供商品编辑页初始化使用。',
        },
      },
    )
    .post(
      '/admin/products',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const product = await productsService.createRechargeProduct(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_RECHARGE_PRODUCT',
          resourceType: 'RECHARGE_PRODUCT',
          resourceId: product.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: product.id,
            resourceType: 'RECHARGE_PRODUCT',
            status: product.status,
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        body: SaveRechargeProductBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '创建平台商品',
          description: '后台新增平台充值商品主数据，供供应商映射与渠道授权引用。',
        },
      },
    )
    .put(
      '/admin/products/:productId',
      async ({ body, params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const product = await productsService.updateRechargeProduct(params.productId, body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPDATE_RECHARGE_PRODUCT',
          resourceType: 'RECHARGE_PRODUCT',
          resourceId: product.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: product.id,
            resourceType: 'RECHARGE_PRODUCT',
            status: product.status,
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        params: ProductIdParamsSchema,
        body: SaveRechargeProductBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '更新平台商品',
          description: '后台修改平台充值商品主数据，不影响平台商品与供应商映射的边界。',
        },
      },
    );

  const openRoutes = new Elysia({ prefix: '/open-api/products' }).get(
    '/',
    async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      await channelsService.authenticateOpenRequest({
        accessKey: request.headers.get('AccessKey') ?? '',
        signature: request.headers.get('Sign') ?? '',
        timestamp: request.headers.get('Timestamp') ?? '',
        nonce: request.headers.get('Nonce') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        bodyText: '',
      });

      return ok(requestId, await productsService.listProducts());
    },
    {
      detail: {
        tags: ['open-api'],
        summary: '列出可售充值商品',
        description: '渠道侧获取当前可售 ISP 充值商品列表。',
      },
    },
  );

  const internalRoutes = new Elysia({ prefix: '/internal/products' }).get(
    '/recharge/match',
    async ({ query, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));

      return ok(
        requestId,
        await productsService.matchRechargeProduct({
          mobile: query.mobile,
          faceValue: query.faceValue,
          productType: query.productType,
        }),
      );
    },
    {
      query: t.Object({
        mobile: t.String({ minLength: 11, maxLength: 11 }),
        faceValue: t.Numeric({ minimum: 1 }),
        productType: t.Optional(RechargeProductTypeSchema),
      }),
      detail: {
        tags: ['internal'],
        summary: '匹配充值商品',
        description: '根据手机号号段、面值与充值模式匹配可下单商品。',
      },
    },
  );

  return new Elysia().use(adminRoutes).use(openRoutes).use(internalRoutes);
}
