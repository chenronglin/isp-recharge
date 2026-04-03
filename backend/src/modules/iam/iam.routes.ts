import { Elysia, t } from 'elysia';
import { writeAuditLog } from '@/lib/audit';
import { requireAnyAdminRole } from '@/lib/admin-roles';
import { verifyAdminAuthorizationHeader } from '@/lib/auth';
import { buildPageResult, ok, parsePagination } from '@/lib/http';
import { getClientIpFromRequest, getRequestIdFromRequest } from '@/lib/route-meta';
import {
  AssignAdminUserRoleBodySchema,
  CreateAdminUserBodySchema,
  CreateRoleBodySchema,
  LoginBodySchema,
  RefreshBodySchema,
  UpdateAdminUserStatusBodySchema,
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
        return ok(
          requestId,
          await iamService.login({
            username: body.username,
            password: body.password,
            ip: getClientIpFromRequest(request),
            deviceSummary: request.headers.get('user-agent') ?? '',
          }),
        );
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
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['SUPER_ADMIN']);
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
        requireAnyAdminRole(operator, ['SUPER_ADMIN']);
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
    )
    .patch(
      '/:userId/status',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['SUPER_ADMIN']);
        const updatedUser = await iamService.updateUserStatus(params.userId, body.status);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'UPDATE_ADMIN_USER_STATUS',
          resourceType: 'ADMIN_USER',
          resourceId: updatedUser.id,
          details: {
            status: body.status,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, updatedUser);
      },
      {
        body: UpdateAdminUserStatusBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '更新后台用户状态',
          description: '启用或停用后台管理员账号，并记录操作审计日志。',
        },
      },
    )
    .post(
      '/:userId/roles',
      async ({ params, body, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const clientIp = getClientIpFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const operator = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(operator, ['SUPER_ADMIN']);
        await iamService.assignRole(params.userId, body.roleCode);

        await writeAuditLog({
          operatorUserId: operator.userId,
          operatorUsername: operator.username,
          action: 'ASSIGN_ADMIN_USER_ROLE',
          resourceType: 'ADMIN_USER',
          resourceId: params.userId,
          details: {
            roleCode: body.roleCode,
          },
          requestId,
          ip: clientIp,
        });

        return ok(requestId, { success: true });
      },
      {
        body: AssignAdminUserRoleBodySchema,
        response: t.Any(),
        detail: {
          tags: ['admin'],
          summary: '为后台用户分配角色',
          description: '为指定后台用户追加角色绑定，用于权限控制与岗位授权。',
        },
      },
    );

  const roleRoutes = new Elysia({ prefix: '/admin/roles' })
    .get(
      '/',
      async ({ request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['SUPER_ADMIN']);
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
        requireAnyAdminRole(operator, ['SUPER_ADMIN']);
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

  const logRoutes = new Elysia({ prefix: '/admin' })
    .get(
      '/audit-logs',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['SUPER_ADMIN']);
        const { page, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await iamService.listAuditLogs(page, pageSize);

        return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询操作审计日志',
          description: '后台分页查询敏感写操作的统一审计日志记录。',
        },
      },
    )
    .get(
      '/login-logs',
      async ({ query, request }) => {
        const requestId = getRequestIdFromRequest(request);
        const payload = await verifyAdminAuthorizationHeader(request.headers.get('authorization'));
        const admin = await iamService.requireActiveAdmin(payload.sub);
        requireAnyAdminRole(admin, ['SUPER_ADMIN']);
        const { page, pageSize } = parsePagination(query as Record<string, unknown>);
        const result = await iamService.listLoginLogs(page, pageSize);

        return ok(requestId, buildPageResult(result.items, page, pageSize, result.total));
      },
      {
        detail: {
          tags: ['admin'],
          summary: '查询后台登录日志',
          description: '后台分页查询管理员登录成功、失败、锁定和禁用等安全日志。',
        },
      },
    );

  return new Elysia().use(authRoutes).use(userRoutes).use(roleRoutes).use(logRoutes);
}
