import { Elysia } from 'elysia';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerService } from '@/modules/ledger/ledger.service';

interface LedgerRoutesDeps {
  ledgerService: LedgerService;
  iamService: IamService;
}

export function createLedgerRoutes({ ledgerService, iamService }: LedgerRoutesDeps) {
  const adminRoutes = new Elysia()
    .get(
      '/admin/accounts',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await ledgerService.listAccounts());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询账务账户',
          description: '后台查询平台、渠道和供应商等账务账户的余额与状态信息。',
        },
      },
    )
    .get(
      '/admin/ledger-entries',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await ledgerService.listLedgerEntries());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询账务流水',
          description: '后台查询订单资金变动流水，用于对账、排查与财务核对。',
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
