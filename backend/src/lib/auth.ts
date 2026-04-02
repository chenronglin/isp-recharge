import { env } from '@/lib/env';
import { unauthorized } from '@/lib/errors';
import { verifyJwt } from '@/lib/jwt-token';
import { extractBearerToken } from '@/lib/request';

export interface AdminJwtPayload {
  sub: string;
  type: 'admin';
  roleIds: string[];
  scope: string;
  jti: string;
  exp: number;
  iat: number;
}

export interface InternalJwtPayload {
  sub: string;
  type: 'internal';
  roleIds: string[];
  scope: string;
  jti: string;
  exp: number;
  iat: number;
}

export async function verifyAdminAuthorizationHeader(
  authorization?: string | null,
): Promise<AdminJwtPayload> {
  const token = extractBearerToken(authorization);

  if (!token) {
    throw unauthorized('缺少后台 Bearer Token');
  }

  const payload = await verifyJwt<AdminJwtPayload>(token, env.adminJwtSecret);

  if (payload.type !== 'admin') {
    throw unauthorized('后台 Token 类型非法');
  }

  return payload;
}

export async function verifyInternalAuthorizationHeader(
  authorization?: string | null,
): Promise<InternalJwtPayload> {
  const token = extractBearerToken(authorization);

  if (!token) {
    throw unauthorized('缺少内部 Bearer Token');
  }

  const payload = await verifyJwt<InternalJwtPayload>(token, env.internalJwtSecret);

  if (payload.type !== 'internal') {
    throw unauthorized('内部 Token 类型非法');
  }

  return payload;
}
