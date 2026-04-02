import { jwt } from '@elysiajs/jwt';
import { Elysia, t } from 'elysia';

import { env } from '@/lib/env';

const adminJwtSchema = t.Object({
  sub: t.String(),
  type: t.Literal('admin'),
  roleIds: t.Array(t.String()),
  scope: t.String(),
  jti: t.String(),
});

const internalJwtSchema = t.Object({
  sub: t.String(),
  type: t.Literal('internal'),
  roleIds: t.Array(t.String()),
  scope: t.String(),
  jti: t.String(),
});

/**
 * 同时注册后台 JWT 与内部 JWT。
 * 这样 `/admin/**` 与 `/internal/**` 的鉴权口径都能统一复用。
 */
export function createJwtPlugin() {
  return new Elysia({ name: 'jwt-plugin' })
    .use(
      jwt({
        name: 'adminJwt',
        secret: env.adminJwtSecret,
        exp: '15m',
        schema: adminJwtSchema,
      }),
    )
    .use(
      jwt({
        name: 'internalJwt',
        secret: env.internalJwtSecret,
        exp: '5m',
        schema: internalJwtSchema,
      }),
    );
}
