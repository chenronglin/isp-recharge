import { env } from '@/lib/env';
import { badRequest, conflict, forbidden, unauthorized } from '@/lib/errors';
import { generateBusinessNo } from '@/lib/id';
import { signJwt } from '@/lib/jwt-token';
import { hashPassword, hashToken, verifyPassword } from '@/lib/security';
import { addDays } from '@/lib/time';
import type { IamContract } from '@/modules/iam/contracts';
import type { IamRepository } from '@/modules/iam/iam.repository';
import type { AdminContext, LoginResult } from '@/modules/iam/iam.types';

export class IamService implements IamContract {
  constructor(private readonly repository: IamRepository) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.repository.findUserByUsername(username);

    if (!user) {
      throw unauthorized('用户名或密码错误');
    }

    if (user.status !== 'ACTIVE') {
      throw forbidden('账号已被禁用或锁定');
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);

    if (!passwordValid) {
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

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: env.adminAccessTokenExpiresInSeconds,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        status: user.status,
        roleCodes,
      },
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
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        status: user.status,
        roleCodes,
      },
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeSessionByHash(hashToken(refreshToken));
  }

  async requireActiveAdmin(userId: string): Promise<AdminContext> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw unauthorized('账号不存在');
    }

    if (user.status !== 'ACTIVE') {
      throw forbidden('账号已禁用');
    }

    const roles = await this.repository.findRolesByUserId(user.id);

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roleCodes: roles.map((role) => role.roleCode),
    };
  }

  async listUsers(page: number, pageSize: number) {
    return this.repository.listUsers(page, pageSize);
  }

  async listRoles() {
    return this.repository.listRoles();
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
    const roles = await this.repository.listRoles();
    const duplicate = roles.find((role) => role.roleCode === roleCode);

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

    const roles = await this.repository.listRoles();
    const role = roles.find((item) => item.roleCode === roleCode);

    if (!role) {
      throw badRequest('角色不存在');
    }

    await this.repository.assignRole(userId, role.id);
  }
}
