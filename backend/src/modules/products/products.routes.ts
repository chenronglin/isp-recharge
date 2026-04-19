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
  OpenProductsQuerySchema,
  OpenRechargeProductSchema,
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
  const carrierNames: Record<string, string> = {
    CMCC: '中国移动',
    CTCC: '中国电信',
    CUCC: '中国联通',
    CBN: '中国广电',
  };

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
    async ({ query, request }) => {
      const requestId = getRequestIdFromRequest(request);
      const auth = await channelsService.resolveChannelAuthContext({
        authorization: request.headers.get('authorization'),
        accessKey: request.headers.get('AccessKey') ?? request.headers.get('accesskey') ?? '',
        signature: request.headers.get('Sign') ?? request.headers.get('sign') ?? '',
        timestamp: request.headers.get('Timestamp') ?? request.headers.get('timestamp') ?? '',
        nonce: request.headers.get('Nonce') ?? request.headers.get('nonce') ?? '',
        method: request.method,
        path: new URL(request.url).pathname,
        bodyText: '',
      });

      const [products, splitPolicy] = await Promise.all([
        channelsService.listChannelProducts(auth.channel.id, {
          carrierCode: typeof query.carrierCode === 'string' ? query.carrierCode : undefined,
          province: typeof query.province === 'string' ? query.province : undefined,
          faceValue: query.faceValue ? Number(query.faceValue) : undefined,
          productType: typeof query.productType === 'string' ? query.productType : undefined,
          status: typeof query.status === 'string' ? query.status : 'ACTIVE',
        }),
        channelsService.getSplitPolicy(auth.channel.id),
      ]);

      return ok(
        requestId,
        products.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          faceValueFen: item.faceValueFen,
          salePriceFen: item.salePriceFen,
          rechargeRange: [item.faceValueFen],
          arrivalSla: 'T+0',
          carrierCode: item.carrierCode,
          operator: carrierNames[item.carrierCode] ?? item.carrierCode,
          routeStatus: item.status,
          splitSupport:
            splitPolicy.enabled &&
            splitPolicy.allowedFaceValues.some((faceValue) => faceValue * 100 === item.faceValueFen),
        })),
      );
    },
    {
      query: OpenProductsQuerySchema,
      response: createSuccessResponseSchema(t.Array(OpenRechargeProductSchema)),
      detail: {
        tags: ['open-api'],
        summary: '列出可售充值商品',
        description: '渠道侧按当前登录渠道列出商品、售价、路由状态和拆单支持能力。',
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
