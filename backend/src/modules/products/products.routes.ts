import { Elysia, t } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
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
  const adminRoutes = new Elysia().get(
    '/admin/products',
    async ({ request }) => {
      const requestId = getRequestIdFromRequest(request);
      const tokenPayload = await verifyAdminAuthorizationHeader(
        request.headers.get('authorization'),
      );
      await iamService.requireActiveAdmin(tokenPayload.sub);
      return ok(requestId, await productsService.listProducts());
    },
    {
      detail: {
        tags: ['admin'],
        summary: '列出充值商品',
        description: '后台查看当前 V1 ISP 充值商品配置。',
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
        productType: t.Optional(t.Union([t.Literal('FAST'), t.Literal('MIXED')])),
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
