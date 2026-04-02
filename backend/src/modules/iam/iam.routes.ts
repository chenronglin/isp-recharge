import { Elysia, t } from 'elysia';
import { writeAuditLog } from '@/lib/audit';
import { verifyAdminAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, ok, parsePagination } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import {
  CreateAdminUserBodySchema,
  CreateRoleBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
} from '@/modules/iam/iam.schema';
import type { IamService } from '@/modules/iam/iam.service';

interface IamRoutesDeps {
  iamService: IamService;
}

export function createIamRoutes({ iamService }: IamRoutesDeps) {
  const authRoutes = new Elysia({ prefix: '/admin/auth' })
    .post(
      '/login',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(requestId, await iamService.login(body.username, body.password));
      },
      {
        body: LoginBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '管理员账号登录',
          description: '后台管理员使用用户名和密码登录系统，获取访问令牌与刷新令牌。',
        },
      },
    )
    .post(
      '/refresh',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        return ok(requestId, await iamService.refresh(body.refreshToken));
      },
      {
        body: RefreshBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '刷新管理员令牌',
          description: '使用刷新令牌换取新的后台访问令牌与新的刷新令牌。',
        },
      },
    )
    .post(
      '/logout',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        await iamService.logout(body.refreshToken);
        return ok(requestId, { success: true });
      },
      {
        body: RefreshBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '退出管理员登录',
          description: '注销当前管理员刷新令牌，使对应后台登录会话失效。',
        },
      },
    );

  const userRoutes = new Elysia({ prefix: '/admin/users' })
    .get(
      '/',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        const { page, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await iamService.listUsers(page, pageSize);

        return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询后台用户列表',
          description: '后台按分页方式查询管理员用户列表，用于账号维护与权限分配。',
        },
      },
    )
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        const createdUser = await iamService.createUser(body);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_ADMIN_USER',
          resourceType: 'ADMIN_USER',
          resourceId: createdUser.id,
          details: {
            username: createdUser.username,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, createdUser);
      },
      {
        body: CreateAdminUserBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '创建后台用户',
          description: '新增后台管理员账号，并写入基础登录与展示信息。',
        },
      },
    );

  const roleRoutes = new Elysia({ prefix: '/admin/roles' })
    .get(
      '/',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        await iamService.requireActiveAdmin(payload.sub);
        return ok(requestId, await iamService.listRoles());
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询角色列表',
          description: '查询后台角色定义列表，供用户授权和权限配置使用。',
        },
      },
    )
    .post(
      '/',
      async ({ body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        const role = await iamService.createRole(body.roleCode, body.roleName);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'CREATE_ROLE',
          resourceType: 'ROLE',
          resourceId: role.id,
          details: {
            roleCode: role.roleCode,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, role);
      },
      {
        body: CreateRoleBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '创建后台角色',
          description: '新增后台角色编码与角色名称，用于权限体系扩展。',
        },
      },
    );

  return new Elysia().use(authRoutes).use(userRoutes).use(roleRoutes);
}
