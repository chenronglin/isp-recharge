import { describe, expect, test } from 'bun:test';
import { env } from '@/lib/env';
import { signJwt, verifyJwt } from '@/lib/jwt-token';
import {
  buildOpenApiCanonicalString,
  decryptText,
  encryptText,
  signOpenApiPayload,
} from '@/lib/security';

describe('安全基础能力', () => {
  test('JWT 可以正确签发与校验', async () => {
    const token = await signJwt(
      {
        sub: 'admin-user',
        type: 'admin',
        roleIds: ['SUPER_ADMIN'],
        scope: 'admin',
        jti: 'jwt-test',
      },
      env.adminJwtSecret,
      60,
    );

    const payload = await verifyJwt(token, env.adminJwtSecret);

    expect(payload.sub).toBe('admin-user');
    expect(payload.type).toBe('admin');
  });

  test('开放接口签名算法可稳定生成', () => {
    const canonical = buildOpenApiCanonicalString({
      method: 'POST',
      path: '/open-api/orders',
      timestamp: '1710000000000',
      nonce: 'nonce-1',
      body: '{"skuId":"sku-1"}',
    });

    const signature = signOpenApiPayload('demo-secret', canonical);

    expect(signature.length).toBeGreaterThan(10);
  });

  test('敏感字符串可以加解密往返', () => {
    const cipherText = encryptText('hello-world');
    const plainText = decryptText(cipherText);

    expect(plainText).toBe('hello-world');
  });
});
