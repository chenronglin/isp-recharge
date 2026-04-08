import { generateId } from '@/lib/id';
import { db, first } from '@/lib/sql';
import { iamSql } from '@/modules/iam/iam.sql';
import type { AdminUser, AuditLogRecord, LoginLogRecord, Role } from '@/modules/iam/iam.types';

export class IamRepository {
  async findUserByUsername(username: string): Promise<AdminUser | null> {
    return first<AdminUser>(db<AdminUser[]>`
      SELECT
        id,
        username,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        status,
        NULL::text AS "departmentId",
        mobile,
        email,
        last_login_at AS "lastLoginAt",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM iam.admin_users
      WHERE username = ${username}
      LIMIT 1
    `);
  }

  async findUserById(userId: string): Promise<AdminUser | null> {
    return first<AdminUser>(db<AdminUser[]>`
      SELECT
        id,
        username,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        status,
        NULL::text AS "departmentId",
        mobile,
        email,
        last_login_at AS "lastLoginAt",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM iam.admin_users
      WHERE id = ${userId}
      LIMIT 1
    `);
  }

  async listUsers(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: AdminUser[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const keyword = input.keyword?.trim();
    const status = input.status?.trim();
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      lastLoginAt: 'last_login_at',
      username: 'username',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (keyword) {
      params.push(`%${keyword}%`);
      const index = params.length;
      whereClauses.push(
        `(username ILIKE $${index} OR display_name ILIKE $${index} OR COALESCE(email, '') ILIKE $${index})`,
      );
    }

    if (status) {
      params.push(status);
      whereClauses.push(`status = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const items = await db.unsafe<AdminUser[]>(
      `
        SELECT
          id,
          username,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          status,
          NULL::text AS "departmentId",
          mobile,
          email,
          last_login_at AS "lastLoginAt",
          failed_login_attempts AS "failedLoginAttempts",
          locked_until AS "lockedUntil",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM iam.admin_users
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM iam.admin_users
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items,
      total: total?.total ?? 0,
    };
  }

  async listRoles(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: Role[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const keyword = input.keyword?.trim();
    const status = input.status?.trim();
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      roleCode: 'role_code',
      roleName: 'role_name',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (keyword) {
      params.push(`%${keyword}%`);
      const index = params.length;
      whereClauses.push(`(role_code ILIKE $${index} OR role_name ILIKE $${index})`);
    }

    if (status) {
      params.push(status);
      whereClauses.push(`status = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const items = await db.unsafe<Role[]>(
      `
        SELECT
          id,
          role_code AS "roleCode",
          role_name AS "roleName",
          status,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM iam.roles
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM iam.roles
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items,
      total: total?.total ?? 0,
    };
  }

  async findRolesByUserId(userId: string): Promise<Role[]> {
    return db<Role[]>`
      SELECT
        r.id,
        r.role_code AS "roleCode",
        r.role_name AS "roleName",
        r.status,
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt"
      FROM iam.roles r
      INNER JOIN iam.user_role_relations urr
        ON urr.role_id = r.id
      WHERE urr.user_id = ${userId}
      ORDER BY r.role_code ASC
    `;
  }

  async findRoleById(roleId: string): Promise<Role | null> {
    return first<Role>(db<Role[]>`
      SELECT
        id,
        role_code AS "roleCode",
        role_name AS "roleName",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM iam.roles
      WHERE id = ${roleId}
      LIMIT 1
    `);
  }

  async createUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    email?: string;
  }): Promise<AdminUser> {
    const rows = await db<AdminUser[]>`
      INSERT INTO iam.admin_users (
        id,
        username,
        password_hash,
        display_name,
        email,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${input.username},
        ${input.passwordHash},
        ${input.displayName},
        ${input.email ?? null},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        username,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        status,
        NULL::text AS "departmentId",
        mobile,
        email,
        last_login_at AS "lastLoginAt",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const user = rows[0];

    if (!user) {
      throw new Error('创建后台用户失败');
    }

    return user;
  }

  async createRole(roleCode: string, roleName: string): Promise<Role> {
    const rows = await db<Role[]>`
      INSERT INTO iam.roles (
        id,
        role_code,
        role_name,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${roleCode},
        ${roleName},
        'ACTIVE',
        NOW(),
        NOW()
      )
      RETURNING
        id,
        role_code AS "roleCode",
        role_name AS "roleName",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const role = rows[0];

    if (!role) {
      throw new Error('创建角色失败');
    }

    return role;
  }

  async assignRole(userId: string, roleId: string): Promise<void> {
    await db`
      INSERT INTO iam.user_role_relations (user_id, role_id, created_at)
      VALUES (${userId}, ${roleId}, NOW())
      ON CONFLICT (user_id, role_id) DO NOTHING
    `;
  }

  async updateLastLoginAt(userId: string): Promise<void> {
    await db`
      UPDATE iam.admin_users
      SET
        last_login_at = NOW(),
        failed_login_attempts = 0,
        locked_until = NULL,
        updated_at = NOW()
      WHERE id = ${userId}
    `;
  }

  async updateUserStatus(userId: string, status: 'ACTIVE' | 'DISABLED'): Promise<AdminUser | null> {
    return first<AdminUser>(db<AdminUser[]>`
      UPDATE iam.admin_users
      SET
        status = ${status},
        updated_at = NOW()
      WHERE id = ${userId}
      RETURNING
        id,
        username,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        status,
        NULL::text AS "departmentId",
        mobile,
        email,
        last_login_at AS "lastLoginAt",
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);
  }

  async recordLoginAttempt(input: {
    userId: string | null;
    username: string;
    ip: string;
    deviceSummary: string;
    result: 'SUCCESS' | 'FAIL';
    failureReason?: string | null;
  }): Promise<void> {
    await db`
      INSERT INTO iam.login_logs (
        id,
        user_id,
        username,
        ip,
        device_summary,
        result,
        failure_reason,
        created_at
      )
      VALUES (
        ${generateId()},
        ${input.userId},
        ${input.username},
        ${input.ip},
        ${input.deviceSummary},
        ${input.result},
        ${input.failureReason ?? null},
        NOW()
      )
    `;
  }

  async recordFailedPasswordAttempt(
    userId: string,
    lockThreshold: number,
    lockMinutes: number,
  ): Promise<{ failedLoginAttempts: number; lockedUntil: string | null }> {
    const row = await first<{ failedLoginAttempts: number; lockedUntil: string | null }>(db`
      UPDATE iam.admin_users
      SET
        failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE
          WHEN failed_login_attempts + 1 >= ${lockThreshold}
            THEN NOW() + (${lockMinutes} * INTERVAL '1 minute')
          ELSE locked_until
        END,
        updated_at = NOW()
      WHERE id = ${userId}
      RETURNING
        failed_login_attempts AS "failedLoginAttempts",
        locked_until AS "lockedUntil"
    `);

    if (!row) {
      throw new Error('记录登录失败次数失败');
    }

    return row;
  }

  async createSession(userId: string, refreshTokenHash: string, expiresAt: Date): Promise<void> {
    await db`
      INSERT INTO iam.login_sessions (
        id,
        user_id,
        refresh_token_hash,
        status,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        ${generateId()},
        ${userId},
        ${refreshTokenHash},
        'ACTIVE',
        ${expiresAt},
        NOW(),
        NOW()
      )
    `;
  }

  async findActiveSession(
    refreshTokenHash: string,
  ): Promise<{ id: string; userId: string; expiresAt: string } | null> {
    return first<{ id: string; userId: string; expiresAt: string }>(db`
      SELECT
        id,
        user_id AS "userId",
        expires_at AS "expiresAt"
      FROM iam.login_sessions
      WHERE refresh_token_hash = ${refreshTokenHash}
        AND status = 'ACTIVE'
      LIMIT 1
    `);
  }

  async revokeSessionByHash(refreshTokenHash: string): Promise<void> {
    await db`
      UPDATE iam.login_sessions
      SET
        status = 'REVOKED',
        updated_at = NOW()
      WHERE refresh_token_hash = ${refreshTokenHash}
    `;
  }

  async listAuditLogs(input: {
    pageNum: number;
    pageSize: number;
    keyword?: string;
    startTime?: string | null;
    endTime?: string | null;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ items: AuditLogRecord[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const keyword = input.keyword?.trim();
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      action: 'action',
      resourceType: 'resource_type',
      operatorUsername: 'operator_username',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (keyword) {
      params.push(`%${keyword}%`);
      const index = params.length;
      whereClauses.push(
        `(operator_username ILIKE $${index} OR action ILIKE $${index} OR resource_type ILIKE $${index} OR COALESCE(resource_id, '') ILIKE $${index})`,
      );
    }

    if (input.startTime) {
      params.push(input.startTime);
      whereClauses.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (input.endTime) {
      params.push(input.endTime);
      whereClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const items = await db.unsafe<AuditLogRecord[]>(
      `
        SELECT
          id,
          operator_user_id AS "operatorUserId",
          operator_username AS "operatorUsername",
          action,
          resource_type AS "resourceType",
          resource_id AS "resourceId",
          request_id AS "requestId",
          ip,
          details_json AS "detailsJson",
          created_at AS "createdAt"
        FROM iam.operation_audit_logs
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM iam.operation_audit_logs
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items,
      total: total?.total ?? 0,
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
  }): Promise<{ items: LoginLogRecord[]; total: number }> {
    const offset = (input.pageNum - 1) * input.pageSize;
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    const keyword = input.keyword?.trim();
    const status = input.status?.trim();
    const sortByMap: Record<string, string> = {
      createdAt: 'created_at',
      username: 'username',
      result: 'result',
    };
    const orderColumn = sortByMap[input.sortBy ?? ''] ?? 'created_at';
    const orderDirection = input.sortOrder === 'asc' ? 'ASC' : 'DESC';

    if (keyword) {
      params.push(`%${keyword}%`);
      const index = params.length;
      whereClauses.push(`(username ILIKE $${index} OR ip ILIKE $${index})`);
    }

    if (status) {
      params.push(status);
      whereClauses.push(`result = $${params.length}`);
    }

    if (input.startTime) {
      params.push(input.startTime);
      whereClauses.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (input.endTime) {
      params.push(input.endTime);
      whereClauses.push(`created_at <= $${params.length}::timestamptz`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(input.pageSize, offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;
    const items = await db.unsafe<LoginLogRecord[]>(
      `
        SELECT
          id,
          user_id AS "userId",
          username,
          ip,
          device_summary AS "deviceSummary",
          result,
          failure_reason AS "failureReason",
          created_at AS "createdAt"
        FROM iam.login_logs
        ${whereSql}
        ORDER BY ${orderColumn} ${orderDirection}, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params,
    );
    const total = await first<{ total: number }>(
      db.unsafe(
        `
          SELECT COUNT(*)::int AS total
          FROM iam.login_logs
          ${whereSql}
        `,
        params.slice(0, params.length - 2),
      ),
    );

    return {
      items,
      total: total?.total ?? 0,
    };
  }
}
