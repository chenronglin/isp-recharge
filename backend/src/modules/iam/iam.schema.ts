import { t } from 'elysia';
import { SortOrderSchema } from '@/lib/http';

export const LoginBodySchema = t.Object({
  username: t.String({ minLength: 1 }),
  password: t.String({ minLength: 1 }),
});

export const RefreshBodySchema = t.Object({
  refreshToken: t.String({ minLength: 1 }),
});

export const CreateAdminUserBodySchema = t.Object({
  username: t.String({ minLength: 3 }),
  password: t.String({ minLength: 6 }),
  displayName: t.String({ minLength: 1 }),
  email: t.Optional(t.String({ format: 'email' })),
});

export const CreateRoleBodySchema = t.Object({
  roleCode: t.String({ minLength: 2 }),
  roleName: t.String({ minLength: 1 }),
});

export const UpdateAdminUserStatusBodySchema = t.Object({
  status: t.Union([t.Literal('ACTIVE'), t.Literal('DISABLED')]),
});

export const AssignAdminUserRoleBodySchema = t.Object({
  roleCode: t.String({ minLength: 2 }),
});

export const AdminUsersQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const AdminRolesQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const AdminAuditLogsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const AdminLoginLogsQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const AdminUserProfileSchema = t.Object({
  id: t.String(),
  username: t.String(),
  displayName: t.String(),
  status: t.String(),
  roleCodes: t.Array(t.String()),
});

export const AdminUserListItemSchema = t.Object({
  id: t.String(),
  username: t.String(),
  displayName: t.String(),
  status: t.String(),
  roleCodes: t.Array(t.String()),
  email: t.Nullable(t.String()),
  mobile: t.Nullable(t.String()),
  lastLoginAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const AdminUserDetailSchema = t.Object({
  id: t.String(),
  username: t.String(),
  displayName: t.String(),
  status: t.String(),
  roleCodes: t.Array(t.String()),
  email: t.Nullable(t.String()),
  mobile: t.Nullable(t.String()),
  lastLoginAt: t.Nullable(t.String({ format: 'date-time' })),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
  failedLoginAttempts: t.Number(),
  lockedUntil: t.Nullable(t.String({ format: 'date-time' })),
});

export const RoleSchema = t.Object({
  id: t.String(),
  roleCode: t.String(),
  roleName: t.String(),
  status: t.String(),
  createdAt: t.String({ format: 'date-time' }),
  updatedAt: t.String({ format: 'date-time' }),
});

export const LoginResultSchema = t.Object({
  accessToken: t.String(),
  refreshToken: t.String(),
  expiresInSeconds: t.Number(),
  user: AdminUserProfileSchema,
});

export const AuditLogRecordSchema = t.Object({
  id: t.String(),
  operatorUserId: t.Nullable(t.String()),
  operatorUsername: t.String(),
  action: t.String(),
  resourceType: t.String(),
  resourceId: t.Nullable(t.String()),
  requestId: t.String(),
  ip: t.String(),
  detailsJson: t.Record(t.String(), t.Unknown()),
  createdAt: t.String({ format: 'date-time' }),
});

export const LoginLogRecordSchema = t.Object({
  id: t.String(),
  userId: t.Nullable(t.String()),
  username: t.String(),
  ip: t.String(),
  deviceSummary: t.String(),
  result: t.String(),
  failureReason: t.Nullable(t.String()),
  createdAt: t.String({ format: 'date-time' }),
});
