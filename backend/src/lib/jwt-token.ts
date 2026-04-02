import { createHmac } from 'node:crypto';

import { unauthorized } from '@/lib/errors';

interface JwtPayloadBase {
  sub: string;
  type: string;
  roleIds: string[];
  scope: string;
  jti: string;
  exp: number;
  iat: number;
}

function base64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signHs256(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export async function signJwt<TPayload extends Omit<JwtPayloadBase, 'exp' | 'iat'>>(
  payload: TPayload,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const finalPayload = {
    ...payload,
    iat: nowInSeconds,
    exp: nowInSeconds + expiresInSeconds,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(finalPayload));
  const signature = signHs256(`${encodedHeader}.${encodedPayload}`, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function verifyJwt<TPayload extends JwtPayloadBase>(
  token: string,
  secret: string,
): Promise<TPayload> {
  const [header, payload, signature] = token.split('.');

  if (!header || !payload || !signature) {
    throw unauthorized('JWT 格式非法');
  }

  const expectedSignature = signHs256(`${header}.${payload}`, secret);

  if (expectedSignature !== signature) {
    throw unauthorized('JWT 签名校验失败');
  }

  const decodedPayload = JSON.parse(base64urlDecode(payload)) as TPayload;
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (decodedPayload.exp <= nowInSeconds) {
    throw unauthorized('JWT 已过期');
  }

  return decodedPayload;
}
