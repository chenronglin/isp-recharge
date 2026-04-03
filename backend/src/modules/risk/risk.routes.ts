import { Elysia } from 'elysia';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader, verifyInternalAuthorizationHeader } from '@/lib/auth';
import { ok } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import type { IamService } from '@/modules/iam/iam.service';
import {
  CreateBlackWhiteEntryBodySchema,
  CreateRiskRuleBodySchema,
  PreCheckBodySchema,
} from '@/modules/risk/risk.schema';
import type { RiskService } from '@/modules/risk/risk.service';

interface RiskRoutesDeps {
  riskService: RiskService;
  iamService: IamService;
}

export function createRiskRoutes({ riskService, iamService }: RiskRoutesDeps) {
  const adminRoutes = new Elysia({ prefix: '/admin/risk' })
    .get(
      '/rules',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['RISK']);
        return ok(requestId, await riskService.listRules());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询风控规则',
          description: '后台查询已配置的风控规则列表，包括阈值、优先级和启用状态。',
        },
      },
    )
    .post(
      '/rules',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['RISK']);
        const rule = await riskService.createRule(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_RISK_RULE',
          resourceType: 'RISK_RULE',
          resourceId: rule.id,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, rule);
      },
      {
        body: CreateRiskRuleBodySchema,
        detail: {
          tags: ['admin'],
          summary: '创建风控规则',
          description: '后台新增风控规则，定义命中条件、策略参数与优先级。',
        },
      },
    )
    .get(
      '/black-white-lists',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['RISK']);
        return ok(requestId, await riskService.listBlackWhiteEntries());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询黑白名单',
          description: '后台查询手机号、渠道等维度的黑白名单条目，用于人工维护风险名单。',
        },
      },
    )
    .post(
      '/black-white-lists',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['RISK']);
        const entry = await riskService.createBlackWhiteEntry(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPSERT_RISK_BLACK_WHITE_ENTRY',
          resourceType: 'RISK_BLACK_WHITE_ENTRY',
          resourceId: entry?.id ?? null,
          details: body,
          requestId,
          ip: clientIp,
        });

        return ok(requestId, entry);
      },
      {
        body: CreateBlackWhiteEntryBodySchema,
        detail: {
          tags: ['admin'],
          summary: '创建黑白名单条目',
          description: '后台新增黑名单或白名单条目，控制下单前的放行与拦截决策。',
        },
      },
    )
    .get(
      '/decisions',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['RISK']);
        return ok(requestId, await riskService.listDecisions());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询风控决策记录',
          description: '后台查询订单风控预校验的命中结果、原因和上下文快照。',
        },
      },
    );

  const internalRoutes = new Elysia({ prefix: '/internal/risk' }).post(
    '/pre-check',
    async ({ body, request }) => {
      const requestId = getRequestIdFromRequest(request);
      await verifyInternalAuthorizationHeader(request.headers.get('authorization'));
      return ok(requestId, await riskService.preCheck(body));
    },
    {
      body: PreCheckBodySchema,
      detail: {
        tags: ['internal'],
        summary: '执行下单前风控预校验',
        description: '内部服务在订单创建前调用风控模块，返回通过、拒绝或人工复核等结果。',
      },
    },
  );

  return new Elysia().use(adminRoutes).use(internalRoutes);
}
