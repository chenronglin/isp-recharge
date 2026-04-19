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
import { stableStringify } from '@/lib/utils';
import {
  ChannelBalanceSchema,
  ChannelCallbackConfigSchema,
  ChannelCredentialSchema,
  ChannelOrderPolicySchema,
  ChannelProductSchema,
  ChannelRechargeRecordSchema,
  ChannelsListQuerySchema,
  ChannelSchema,
  ChannelSplitPolicySchema,
  ChannelProductsQuerySchema,
  CreateAuthorizationBodySchema,
  CreateCallbackConfigBodySchema,
  CreateChannelBodySchema,
  CreateCredentialBodySchema,
  CreateLimitRuleBodySchema,
  CreatePricePolicyBodySchema,
  PortalLoginBodySchema,
  PortalLoginResultSchema,
  PortalMeSchema,
  UpdateChannelBodySchema,
  UpsertSplitPolicyBodySchema,
} from '@/modules/channels/channels.schema';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';

interface ChannelsRoutesDeps {
  channelsService: ChannelsService;
  iamService: IamService;
}

async function requireResolvedChannelContext(
  channelsService: ChannelsService,
  request: Request,
  body: unknown,
) {
  return channelsService.resolveChannelAuthContext({
    authorization: request.headers.get('authorization'),
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
          'createdAt',
          'desc',
        );
        const result = await channelsService.listChannels({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          status: typeof query.status === 'string' ? query.status : undefined,
          cooperationStatus:
            typeof query.cooperationStatus === 'string' ? query.cooperationStatus : undefined,
          protocolType: typeof query.protocolType === 'string' ? query.protocolType : undefined,
          channelType: typeof query.channelType === 'string' ? query.channelType : undefined,
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: ChannelsListQuerySchema,
        response: createPageResponseSchema(ChannelSchema),
        detail: {
          tags: ['admin'],
          summary: '查询渠道列表',
          description: '后台查询渠道主体基础信息、门户账号、接入方式与启用状态。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await channelsService.getChannelById(params.channelId));
      },
      {
        response: createSuccessResponseSchema(ChannelSchema),
        detail: {
          tags: ['admin'],
          summary: '查询渠道详情',
          description: '后台根据渠道编号查询渠道基础信息、门户账号和合作状态。',
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
        requireAnyAdminRole(operator, ['OPS']);
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

        return ok(
          requestId,
          buildOperationResult({
            resourceId: channel.id,
            resourceType: 'CHANNEL',
            status: channel.status,
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        body: CreateChannelBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '创建渠道主体',
          description: '新增渠道主体基础资料、门户登录账号和接入配置。',
        },
      },
    )
    .put(
      '/admin/channels/:channelId',
      async ({ body, params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const channel = await channelsService.updateChannel(params.channelId, body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPDATE_CHANNEL',
          resourceType: 'CHANNEL',
          resourceId: channel.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: channel.id,
            resourceType: 'CHANNEL',
            status: channel.status,
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        body: UpdateChannelBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '更新渠道主体',
          description: '后台修改渠道基础信息、门户登录账号和合作状态。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/api-keys',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await channelsService.listChannelCredentials(params.channelId));
      },
      {
        response: createSuccessResponseSchema(t.Array(ChannelCredentialSchema)),
        detail: {
          tags: ['admin'],
          summary: '查询渠道接口凭证',
          description: '后台查询指定渠道的开放接口凭证和签名算法。',
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
        requireAnyAdminRole(operator, ['OPS']);
        await channelsService.createCredential(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_CREDENTIAL',
          resourceType: 'CHANNEL_CREDENTIAL',
          resourceId: body.channelId,
          details: { accessKey: body.accessKey },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: body.channelId,
            resourceType: 'CHANNEL_CREDENTIAL',
            status: 'UPSERTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.accessKey,
          }),
        );
      },
      {
        body: CreateCredentialBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '创建渠道接口凭证',
          description: '为指定渠道新增或更新开放接口 API_KEY 凭证。',
        },
      },
    )
    .post(
      '/admin/channel-products',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await channelsService.addAuthorization(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_PRODUCT_AUTHORIZATION',
          resourceType: 'CHANNEL_PRODUCT_AUTHORIZATION',
          resourceId: body.channelId,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: body.channelId,
            resourceType: 'CHANNEL_PRODUCT_AUTHORIZATION',
            status: 'UPSERTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.productId,
          }),
        );
      },
      {
        body: CreateAuthorizationBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '授权渠道商品',
          description: '为渠道授权商品，用于开放接口和门户商品展示。',
        },
      },
    )
    .post(
      '/admin/channel-prices',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await channelsService.upsertPricePolicy(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_PRICE_POLICY',
          resourceType: 'CHANNEL_PRICE_POLICY',
          resourceId: body.channelId,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: body.channelId,
            resourceType: 'CHANNEL_PRICE_POLICY',
            status: 'UPSERTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.productId,
          }),
        );
      },
      {
        body: CreatePricePolicyBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '维护渠道售价',
          description: '为渠道设置商品售价，用于下单校验与门户展示。',
        },
      },
    )
    .post(
      '/admin/channel-limits',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await channelsService.upsertLimitRule(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_LIMIT_RULE',
          resourceType: 'CHANNEL_LIMIT_RULE',
          resourceId: body.channelId,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: body.channelId,
            resourceType: 'CHANNEL_LIMIT_RULE',
            status: 'UPSERTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        body: CreateLimitRuleBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '维护渠道限额',
          description: '设置渠道单笔、日累计、月累计和 QPS 限额。',
        },
      },
    )
    .post(
      '/admin/channel-callback-configs',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        await channelsService.upsertCallbackConfig({
          ...body,
          timeoutSeconds: body.timeoutSeconds ?? 5,
        });

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_CALLBACK_CONFIG',
          resourceType: 'CHANNEL_CALLBACK_CONFIG',
          resourceId: body.channelId,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: body.channelId,
            resourceType: 'CHANNEL_CALLBACK_CONFIG',
            status: 'UPSERTED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
          }),
        );
      },
      {
        body: CreateCallbackConfigBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '维护渠道回调配置',
          description: '维护渠道订单结果回调地址、签名密钥与超时设置。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/callback-config',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await channelsService.getAdminCallbackConfig(params.channelId));
      },
      {
        response: createSuccessResponseSchema(ChannelCallbackConfigSchema),
        detail: {
          tags: ['admin'],
          summary: '查询渠道回调配置',
          description: '后台查询指定渠道的回调地址、签名方式、超时和重试配置。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/order-policy',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await channelsService.getAdminOrderPolicy(params.channelId));
      },
      {
        response: createSuccessResponseSchema(ChannelOrderPolicySchema),
        detail: {
          tags: ['admin'],
          summary: '查询渠道下单策略',
          description: '后台查询指定渠道的商品授权、价格策略与限额策略。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/products',
      async ({ params, query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(
          requestId,
          await channelsService.listChannelProducts(params.channelId, {
            carrierCode: typeof query.carrierCode === 'string' ? query.carrierCode : undefined,
            province: typeof query.province === 'string' ? query.province : undefined,
            faceValue: query.faceValue ? Number(query.faceValue) : undefined,
            status: typeof query.status === 'string' ? query.status : undefined,
          }),
        );
      },
      {
        query: ChannelProductsQuerySchema,
        response: createSuccessResponseSchema(t.Array(ChannelProductSchema)),
        detail: {
          tags: ['admin'],
          summary: '查询渠道商品列表',
          description: '后台查询渠道已授权商品、售价与当前路由供应商。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/balance',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS', 'FINANCE']);
        return ok(requestId, await channelsService.getChannelBalance(params.channelId));
      },
      {
        response: createSuccessResponseSchema(ChannelBalanceSchema),
        detail: {
          tags: ['admin'],
          summary: '查询渠道余额',
          description: '后台查询渠道余额账户的可用余额、冻结余额和状态。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/recharge-records',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS', 'FINANCE']);
        return ok(requestId, await channelsService.listChannelRechargeRecords(params.channelId));
      },
      {
        response: createSuccessResponseSchema(t.Array(ChannelRechargeRecordSchema)),
        detail: {
          tags: ['admin'],
          summary: '查询渠道充值记录',
          description: '后台查询渠道充值记录，核对余额补款和账务流水。',
        },
      },
    )
    .get(
      '/admin/channels/:channelId/split-policy',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const admin = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(admin, ['OPS']);
        return ok(requestId, await channelsService.getSplitPolicy(params.channelId));
      },
      {
        response: createSuccessResponseSchema(ChannelSplitPolicySchema),
        detail: {
          tags: ['admin'],
          summary: '查询拆单策略',
          description: '后台查询渠道拆单策略配置，用于预览和真实下单。',
        },
      },
    )
    .put(
      '/admin/channels/:channelId/split-policy',
      async ({ body, params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const tokenPayload = await verifyAdminAuthorizationHeader(
          request.headers.get('authorization'),
        );
        const operator = await iamService.requireActiveAdmin(tokenPayload.sub);
        requireAnyAdminRole(operator, ['OPS']);
        const policy = await channelsService.upsertSplitPolicy(params.channelId, body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_CHANNEL_SPLIT_POLICY',
          resourceType: 'CHANNEL_SPLIT_POLICY',
          resourceId: params.channelId,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, policy);
      },
      {
        body: UpsertSplitPolicyBodySchema,
        response: createSuccessResponseSchema(ChannelSplitPolicySchema),
        detail: {
          tags: ['admin'],
          summary: '维护拆单策略',
          description: '后台维护渠道可拆面值、最大拆单片数和偏好规则。',
        },
      },
    );

  const portalRoutes = new Elysia({ prefix: '/portal' })
    .post(
      '/auth/login',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(
          requestId,
          await channelsService.portalLogin({
            username: body.username,
            password: body.password,
            ip: getClientIpFromRequest(request),
            deviceSummary: request.headers.get('user-agent') ?? '',
          }),
        );
      },
      {
        body: PortalLoginBodySchema,
        response: createSuccessResponseSchema(PortalLoginResultSchema),
        detail: {
          tags: ['open-api'],
          summary: '渠道门户登录',
          description: '渠道门户使用用户名和密码登录，获取浏览器友好的 Bearer 会话。',
        },
      },
    )
    .post(
      '/auth/logout',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        await channelsService.portalLogout(request.headers.get('authorization'));
        return ok(
          requestId,
          buildOperationResult({
            resourceId: 'current-session',
            resourceType: 'CHANNEL_PORTAL_SESSION',
            status: 'REVOKED',
            operator: {
              userId: 'channel-portal',
              username: 'channel-portal',
              displayName: 'channel-portal',
            },
          }),
        );
      },
      {
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['open-api'],
          summary: '渠道门户登出',
          description: '注销当前渠道门户 Bearer 会话。',
        },
      },
    )
    .get(
      '/me',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(requestId, await channelsService.getPortalMe(request.headers.get('authorization')));
      },
      {
        response: createSuccessResponseSchema(PortalMeSchema),
        detail: {
          tags: ['open-api'],
          summary: '查询当前渠道门户信息',
          description: '返回当前门户登录渠道的基础信息、角色和固定权限集。',
        },
      },
    );

  const openRoutes = new Elysia({ prefix: '/open-api/channel' })
    .get(
      '/profile',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const auth = await requireResolvedChannelContext(channelsService, request, {});
        return ok(requestId, await channelsService.getChannelById(auth.channel.id));
      },
      {
        response: createSuccessResponseSchema(ChannelSchema),
        detail: {
          tags: ['open-api'],
          summary: '查询渠道档案',
          description: '渠道侧通过签名鉴权或门户 Bearer 会话查询当前渠道档案信息。',
        },
      },
    )
    .get(
      '/quota',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const auth = await requireResolvedChannelContext(channelsService, request, {});
        const policy = await channelsService
          .getOrderPolicy({
            channelId: auth.channel.id,
            productId: '',
            orderAmount: 0,
          })
          .catch(() => null);

        return ok(requestId, {
          channelId: auth.channel.id,
          limitRule: policy?.limitRule
            ? {
                singleLimitAmountFen: Math.round(policy.limitRule.singleLimit * 100),
                dailyLimitAmountFen: Math.round(policy.limitRule.dailyLimit * 100),
                monthlyLimitAmountFen: Math.round(policy.limitRule.monthlyLimit * 100),
                qpsLimit: policy.limitRule.qpsLimit,
              }
            : null,
        });
      },
      {
        response: createSuccessResponseSchema(
          t.Object({
            channelId: t.String(),
            limitRule: t.Nullable(
              t.Object({
                singleLimitAmountFen: t.Number(),
                dailyLimitAmountFen: t.Number(),
                monthlyLimitAmountFen: t.Number(),
                qpsLimit: t.Number(),
              }),
            ),
          }),
        ),
        detail: {
          tags: ['open-api'],
          summary: '查询渠道额度信息',
          description: '渠道侧查询当前渠道的限额配置，支持签名或门户 Bearer 双鉴权。',
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
          description: '内部服务校验渠道开放接口签名并返回渠道上下文信息。',
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
          description: '内部服务读取指定渠道的商品授权、限额和价格策略。',
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
          description: '内部服务读取指定渠道的结果通知回调配置。',
        },
      },
    );

  return new Elysia().use(adminRoutes).use(portalRoutes).use(openRoutes).use(internalRoutes);
}
