import { Elysia } from 'elysia';
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
  parseOptionalDateTime,
  parsePagination,
  parseSort,
} from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import type { ChannelsService } from '@/modules/channels/channels.service';
import type { IamService } from '@/modules/iam/iam.service';
import {
  AccountsListQuerySchema,
  AccountSchema,
  LedgerEntriesListQuerySchema,
  LedgerEntrySchema,
  RechargeChannelAccountBodySchema,
} from '@/modules/ledger/ledger.schema';
import type { LedgerService } from '@/modules/ledger/ledger.service';

interface LedgerRoutesDeps {
  ledgerService: LedgerService;
  iamService: IamService;
  channelsService: ChannelsService;
}

export function createLedgerRoutes({
  ledgerService,
  iamService,
  channelsService,
}: LedgerRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/accounts',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['FINANCE']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortBy, sortOrder } = parseSort(
          query as Record<string, unknown>,
          'createdAt',
          'desc',
        );
        const result = await ledgerService.listAccounts({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          status: typeof query.status === 'string' ? query.status : undefined,
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: AccountsListQuerySchema,
        response: createPageResponseSchema(AccountSchema),
        detail: {
          tags: ['admin'],
          summary: '查询账务账户',
          description: '后台查询平台、渠道和供应商等账务账户的余额与状态信息。',
        },
      },
    )
    .get(
      '/admin/accounts/:accountId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['FINANCE']);
        return ok(requestId, await ledgerService.getAccountById(params.accountId));
      },
      {
        response: createSuccessResponseSchema(AccountSchema),
        detail: {
          tags: ['admin'],
          summary: '查询账务账户详情',
          description: '后台根据账户编号查询账户余额、状态与归属信息。',
        },
      },
    )
    .get(
      '/admin/ledger-entries',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['FINANCE']);
        const { pageNum, pageSize } = parsePagination(query as Record<string, unknown>);
        const { sortBy, sortOrder } = parseSort(
          query as Record<string, unknown>,
          'createdAt',
          'desc',
        );
        const result = await ledgerService.listLedgerEntries({
          pageNum,
          pageSize,
          keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
          startTime: parseOptionalDateTime(query.startTime),
          endTime: parseOptionalDateTime(query.endTime),
          accountId: typeof query.accountId === 'string' ? query.accountId : undefined,
          orderNo: typeof query.orderNo === 'string' ? query.orderNo : undefined,
          channelId: typeof query.channelId === 'string' ? query.channelId : undefined,
          entryType: typeof query.entryType === 'string' ? query.entryType : undefined,
          bizNo: typeof query.bizNo === 'string' ? query.bizNo : undefined,
          sortBy,
          sortOrder,
        });
        return ok(requestId, buildPageResult(result.items, pageNum, pageSize, result.total));
      },
      {
        query: LedgerEntriesListQuerySchema,
        response: createPageResponseSchema(LedgerEntrySchema),
        detail: {
          tags: ['admin'],
          summary: '查询账务流水',
          description: '后台查询订单资金变动流水，用于对账、排查与财务核对。',
        },
      },
    )
    .get(
      '/admin/ledger-entries/:entryId',
      async ({ params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['FINANCE']);
        return ok(requestId, await ledgerService.getLedgerEntryById(params.entryId));
      },
      {
        response: createSuccessResponseSchema(LedgerEntrySchema),
        detail: {
          tags: ['admin'],
          summary: '查询账务流水详情',
          description: '后台根据流水主键查询单笔账务变动详情，用于财务核对和退款排查。',
        },
      },
    )
    .post(
      '/admin/channels/:channelId/recharge',
      async ({ body, params, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['FINANCE']);
        await channelsService.getChannelById(params.channelId);
        const result = await ledgerService.rechargeChannelBalance({
          channelId: params.channelId,
          amount: body.amount,
          referenceNo: requestId,
        });

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'RECHARGE_CHANNEL_BALANCE',
          resourceType: 'CHANNEL_ACCOUNT',
          resourceId: params.channelId,
          details: {
            amount: body.amount,
            remark: body.remark ?? null,
            referenceNo: result.referenceNo,
          },
          requestId,
          ip: clientIp,
        });

        return ok(
          requestId,
          buildOperationResult({
            resourceId: params.channelId,
            resourceType: 'CHANNEL_ACCOUNT',
            status: 'RECHARGED',
            operator: {
              userId: operator.userId,
              username: operator.username,
              displayName: operator.displayName,
            },
            remark: body.remark,
          }),
        );
      },
      {
        body: RechargeChannelAccountBodySchema,
        response: createSuccessResponseSchema(OperationResultSchema),
        detail: {
          tags: ['admin'],
          summary: '为渠道账户充值',
          description: '后台为指定渠道补充预付余额，首次充值会自动初始化渠道账务账户。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/settlement' })
    .post(
      '/accounts/freeze',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        return ok(requestId, { success: true, note: 'V1 暂未启用冻结逻辑' });
      },
      {
        detail: {
          tags: ['internal'],
          summary: '冻结账户余额（待定）',
          description:
            '预留给内部结算流程的账户冻结接口，V1 当前仅保留协议，尚未启用真实冻结处理。',
        },
      },
    )
    .post(
      '/accounts/unfreeze',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
        return ok(requestId, { success: true, note: 'V1 暂未启用解冻逻辑' });
      },
      {
        detail: {
          tags: ['internal'],
          summary: '解冻账户余额（待定）',
          description:
            '预留给内部结算流程的账户解冻接口，V1 当前仅保留协议，尚未启用真实解冻处理。',
        },
      },
    );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
