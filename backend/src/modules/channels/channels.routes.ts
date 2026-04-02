import { Elysia } from 'elysia';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import { stableStringify } from '@/lib/utils';
import {
  CreateAuthorizationBodySchema,
  CreateCallbackConfigBodySchema,
  CreateChannelBodySchema,
  CreateCredentialBodySchema,
  CreateLimitRuleBodySchema,
  CreatePricePolicyBodySchema,
} from '@/modules/channels/channels.schema';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';

interface ChannelsRoutesDeps {
  channelsService: ChannelsService;
  iamService: IamService;
}

async function requireOpenChannelContext(
  channelsService: ChannelsService,
  request: Request,
  body: unknown,
) {
  return channelsService.authenticateOpenRequest({
    accessKey: request.headers.get('AccessKey') ?? request.headers.get('accesskey') ?? '',
    signature: request.headers.get('Sign') ?? request.headers.get('sign') ?? '',
    timestamp: request.headers.get('Timestamp') ?? request.headers.get('timestamp') ?? '',
    nonce: request.headers.get('Nonce') ?? request.headers.get('nonce') ?? '',
    method: request.method,
    path: new URL(request.url).pathname,
    bodyText: stableStringify(body),
  });
}

export function createChannelsRoutes({ channelsService, iamService }: ChannelsRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/channels',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        return ok(requestId, await channelsService.listChannels());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询渠道列表',
          description: '后台查询渠道主体基础信息、接入方式与当前启用状态。',
        },
      },
    )
    .post(
      '/admin/channels',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        const channel = await channelsService.createChannel(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_CHANNEL',
          resourceType: 'CHANNEL',
          resourceId: channel.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, channel);
      },
      {
        body: CreateChannelBodySchema,
        detail: {
          tags: ['admin'],
          summary: '创建渠道主体',
          description: '新增渠道主体基础资料，为后续凭证、授权、价格和回调配置提供归属。',
        },
      },
    )
    .get(
      '/admin/channel-api-keys',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        return ok(requestId, await channelsService.listCredentials());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询渠道接口凭证',
          description: '后台查询渠道开放接口的 AccessKey、签名算法和生效状态。',
        },
      },
    )
    .post(
      '/admin/channel-api-keys',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.createCredential(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_CREDENTIAL',
          resourceType: 'CHANNEL_CREDENTIAL',
          resourceId: body.channelId,
          details: {
            accessKey: body.accessKey,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
        body: CreateCredentialBodySchema,
        detail: {
          tags: ['admin'],
          summary: '创建渠道接口凭证',
          description: '为指定渠道新增或更新开放接口凭证，用于签名鉴权和接口访问。',
        },
      },
    )
    .post(
      '/admin/channel-products',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.addAuthorization(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreateAuthorizationBodySchema,
        detail: {
          tags: ['admin'],
          summary: '配置渠道商品授权',
          description: '为渠道分配可销售商品，控制开放接口允许下单的商品范围。',
        },
      },
    )
    .post(
      '/admin/channel-prices',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertPricePolicy(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreatePricePolicyBodySchema,
        detail: {
          tags: ['admin'],
          summary: '配置渠道销售价策略',
          description: '为渠道维护商品销售价格策略，支撑报价与订单计费逻辑。',
        },
      },
    )
    .post(
      '/admin/channel-limits',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertLimitRule(body);
        return ok(requestId, { success: true });
      },
      {
        body: CreateLimitRuleBodySchema,
        detail: {
          tags: ['admin'],
          summary: '配置渠道限额规则',
          description: '配置渠道单笔、日累计、月累计和 QPS 等风控限额参数。',
        },
      },
    )
    .post(
      '/admin/channel-callback-configs',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        await iamService.requireActiveAdmin(tokenPayload.sub);
        await channelsService.upsertCallbackConfig({
          ...body,
          timeoutSeconds: body.timeoutSeconds ?? 5,
        });
        return ok(requestId, { success: true });
      },
      {
        body: CreateCallbackConfigBodySchema,
        detail: {
          tags: ['admin'],
          summary: '配置渠道回调参数',
          description: '维护渠道订单结果通知地址、签名密钥和重试超时等回调配置。',
        },
      },
    );

  const openRoutes = new Elysia({ prefix: '/open-api/channel' })
    .get(
      '/profile',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const auth = await requireOpenChannelContext(channelsService, request, {});
        return ok(requestId, auth.channel);
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询渠道档案',
          description: '渠道侧使用签名鉴权查询当前 AccessKey 对应的渠道主体信息。',
        },
      },
    )
    .get(
      '/quota',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const auth = await requireOpenChannelContext(channelsService, request, {});
        const policy = await channelsService
          .getOrderPolicy({
            channelId: auth.channel.id,
            productId: '',
            orderAmount: 0,
          })
          .catch(() => null);

        return ok(requestId, {
          channelId: auth.channel.id,
          limitRule: policy?.limitRule ?? null,
        });
      },
      {
        detail: {
          tags: ['open-api'],
          summary: '查询渠道额度信息',
          description: '渠道侧查询当前渠道的下单限额配置，便于预判可用额度与限流策略。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/channels' })
    .post(
      '/resolve-access-key',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        const payloadBody = body as Record<string, string>;
        const auth = await channelsService.authenticateOpenRequest({
          accessKey: payloadBody.accessKey,
          signature: payloadBody.signature,
          timestamp: payloadBody.timestamp,
          nonce: payloadBody.nonce,
          method: payloadBody.method,
          path: payloadBody.path,
          bodyText: payloadBody.bodyText,
        });

        return ok(requestId, auth);
      },
      {
        detail: {
          tags: ['internal'],
          summary: '解析渠道开放签名',
          description: '内部服务根据开放接口请求要素解析并校验渠道 AccessKey、签名和上下文信息。',
        },
      },
    )
    .get(
      '/:channelId/order-policy',
      async ({ params, query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        const result = await channelsService.getOrderPolicy({
          channelId: params.channelId,
          productId: String(query.productId ?? ''),
          orderAmount: Number(query.orderAmount ?? 0),
        });

        return ok(requestId, result);
      },
      {
        detail: {
          tags: ['internal'],
          summary: '查询渠道下单策略',
          description: '内部服务读取指定渠道的商品授权、限额和价格策略，用于下单前决策。',
        },
      },
    )
    .get(
      '/:channelId/callback-config',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        return ok(requestId, await channelsService.getCallbackConfig(params.channelId));
      },
      {
        detail: {
          tags: ['internal'],
          summary: '查询渠道回调配置',
          description: '内部服务读取指定渠道的结果通知地址、签名方式和回调超时参数。',
        },
      },
    );

  return new Elysia().use(adminRoutes).use(openRoutes).use(internalRoutes);
}
