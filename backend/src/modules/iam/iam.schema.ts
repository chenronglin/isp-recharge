import { t } from 'elysia';

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
