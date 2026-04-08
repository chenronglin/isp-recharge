import { env } from '@/lib/env';
import { badRequest, conflict, forbidden, unauthorized } from '@/lib/errors';
import { generateBusinessNo } from '@/lib/id';
import { signJwt } from '@/lib/jwt-token';
import { hashPassword, hashToken, verifyPassword } from '@/lib/security';
import { addDays } from '@/lib/time';
import { toIsoDateTime } from '@/lib/utils';
import type { IamContract } from '@/modules/iam/contracts';
import type { IamRepository } from '@/modules/iam/iam.repository';
import type {
  AdminContext,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserProfile,
  LoginResult,
} from '@/modules/iam/iam.types';

const loginFailureLockThreshold = 5;
const loginFailureLockMinutes = 15;

export class IamService implements IamContract {
  constructor(private readonly repository: IamRepository) {}

  private async buildAdminUserProfile(userId: string): Promise<AdminUserProfile> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw unauthorized('账号不存在');
    }

    const roles = await this.repository.findRolesByUserId(user.id);

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roleCodes: roles.map((role) => role.roleCode),
    };
  }

  private async toAdminUserListItem(userId: string): Promise<AdminUserListItem> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw unauthorized('账号不存在');
    }

    const profile = await this.buildAdminUserProfile(user.id);

    return {
      ...profile,
      email: user.email,
      mobile: user.mobile,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async login(input: {
    username: string;
    password: string;
    ip: string;
    deviceSummary: string;
  }): Promise<LoginResult> {
    const user = await this.repository.findUserByUsername(input.username);

    if (!user) {
      await this.repository.recordLoginAttempt({
        userId: null,
        username: input.username,
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason: 'USER_NOT_FOUND',
      });
      throw unauthorized('用户名或密码错误');
    }

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      await this.repository.recordLoginAttempt({
        userId: user.id,
        username: user.username,
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason: 'ACCOUNT_LOCKED',
      });
      throw forbidden('账号已被临时锁定');
    }

    if (user.status !== 'ACTIVE') {
      await this.repository.recordLoginAttempt({
        userId: user.id,
        username: user.username,
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason: 'ACCOUNT_DISABLED',
      });
      throw forbidden('账号已被禁用或锁定');
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);

    if (!passwordValid) {
      const failureState = await this.repository.recordFailedPasswordAttempt(
        user.id,
        loginFailureLockThreshold,
        loginFailureLockMinutes,
      );
      await this.repository.recordLoginAttempt({
        userId: user.id,
        username: user.username,
        ip: input.ip,
        deviceSummary: input.deviceSummary,
        result: 'FAIL',
        failureReason:
          failureState.lockedUntil && new Date(failureState.lockedUntil).getTime() > Date.now()
            ? 'ACCOUNT_LOCKED'
            : 'PASSWORD_INVALID',
      });
      if (failureState.lockedUntil && new Date(failureState.lockedUntil).getTime() > Date.now()) {
        throw forbidden('账号已被临时锁定');
      }
      throw unauthorized('用户名或密码错误');
    }

    const roles = await this.repository.findRolesByUserId(user.id);
    const roleCodes = roles.map((role) => role.roleCode);
    const accessToken = await signJwt(
      {
        sub: user.id,
        type: 'admin',
        roleIds: roleCodes,
        scope: 'admin',
        jti: generateBusinessNo('adm'),
      },
      env.adminJwtSecret,
      env.adminAccessTokenExpiresInSeconds,
    );
    const refreshToken = generateBusinessNo('refresh');

    await this.repository.createSession(user.id, hashToken(refreshToken), addDays(new Date(), 7));
    await this.repository.updateLastLoginAt(user.id);
    await this.repository.recordLoginAttempt({
      userId: user.id,
      username: user.username,
      ip: input.ip,
      deviceSummary: input.deviceSummary,
      result: 'SUCCESS',
      failureReason: null,
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: env.adminAccessTokenExpiresInSeconds,
      user: await this.buildAdminUserProfile(user.id),
    };
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const refreshHash = hashToken(refreshToken);
    const session = await this.repository.findActiveSession(refreshHash);

    if (!session) {
      throw unauthorized('Refresh Token 无效');
    }

    const user = await this.repository.findUserById(session.userId);

    if (!user || user.status !== 'ACTIVE') {
      throw unauthorized('当前账号不可用');
    }

    const roles = await this.repository.findRolesByUserId(user.id);
    const roleCodes = roles.map((role) => role.roleCode);
    const accessToken = await signJwt(
      {
        sub: user.id,
        type: 'admin',
        roleIds: roleCodes,
        scope: 'admin',
        jti: generateBusinessNo('adm'),
      },
      env.adminJwtSecret,
      env.adminAccessTokenExpiresInSeconds,
    );
    const nextRefreshToken = generateBusinessNo('refresh');

    await this.repository.revokeSessionByHash(refreshHash);
    await this.repository.createSession(
      user.id,
      hashToken(nextRefreshToken),
      addDays(new Date(), 7),
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresInSeconds: env.adminAccessTokenExpiresInSeconds,
      user: await this.buildAdminUserProfile(user.id),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeSessionByHash(hashToken(refreshToken));
  }

  async requireActiveAdmin(userId: string): Promise<AdminContext> {
    const profile = await this.buildAdminUserProfile(userId);
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw unauthorized('账号不存在');
    }

    if (user.status !== 'ACTIVE') {
      throw forbidden('账号已禁用');
    }

    return {
      userId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      roleCodes: profile.roleCodes,
    };
  }

  async getCurrentAdminProfile(userId: string): Promise<AdminUserProfile> {
    return this.buildAdminUserProfile(userId);
  }

  async listUsers(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listUsers(input);
    const items = await Promise.all(result.items.map((item) => this.toAdminUserListItem(item.id)));

    return {
      items,
      total: result.total,
    };
  }

  async getUserDetail(userId: string): Promise<AdminUserDetail> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw badRequest('用户不存在');
    }

    const base = await this.toAdminUserListItem(user.id);

    return {
      ...base,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    };
  }

  async listAuditLogs(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listAuditLogs(input);
    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      })),
      total: result.total,
    };
  }

  async listLoginLogs(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const result = await this.repository.listLoginLogs(input);
    return {
      items: result.items.map((item) => ({
        ...item,
        createdAt: toIsoDateTime(item.createdAt) ?? item.createdAt,
      })),
      total: result.total,
    };
  }

  async listRoles(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    return this.repository.listRoles(input);
  }

  async getRoleDetail(roleId: string) {
    const role = await this.repository.findRoleById(roleId);

    if (!role) {
      throw badRequest('角色不存在');
    }

    return role;
  }

  async createUser(input: {
    username: string;
    password: string;
    displayName: string;
    email?: string;
  }) {
    const existing = await this.repository.findUserByUsername(input.username);

    if (existing) {
      throw conflict('用户名已存在');
    }

    const passwordHash = await hashPassword(input.password);

    return this.repository.createUser({
      username: input.username,
      passwordHash,
      displayName: input.displayName,
      email: input.email,
    });
  }

  async createRole(roleCode: string, roleName: string) {
    const roles = await this.repository.listRoles({
      pageNum: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    const duplicate = roles.items.find((role) => role.roleCode === roleCode);

    if (duplicate) {
      throw conflict('角色编码已存在');
    }

    return this.repository.createRole(roleCode, roleName);
  }

  async assignRole(userId: string, roleCode: string): Promise<void> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw badRequest('用户不存在');
    }

    const roles = await this.repository.listRoles({
      pageNum: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    const role = roles.items.find((item) => item.roleCode === roleCode);

    if (!role) {
      throw badRequest('角色不存在');
    }

    await this.repository.assignRole(userId, role.id);
  }

  async updateUserStatus(userId: string, status: 'ACTIVE' | 'DISABLED') {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw badRequest('用户不存在');
    }

    const updated = await this.repository.updateUserStatus(userId, status);

    if (!updated) {
      throw badRequest('更新用户状态失败');
    }

    return updated;
  }
}
