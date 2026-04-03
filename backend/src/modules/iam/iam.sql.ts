export const iamSql = {
  listUsers: `
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
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `,
  countUsers: `
    SELECT COUNT(*)::int AS total
    FROM iam.admin_users
  `,
  listRoles: `
    SELECT
      id,
      role_code AS "roleCode",
      role_name AS "roleName",
      status,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM iam.roles
    ORDER BY created_at DESC
  `,
} as const;
