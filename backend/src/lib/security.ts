import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '@/lib/env';

/**
 * 密码、密钥、签名、加解密工具。
 * 这里集中管理是为了避免不同模块出现不一致的安全实现。
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function getEncryptionKeyBuffer(): Buffer {
  return createHash('sha256').update(env.encryptionKey).digest();
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: 4 * 1024,
    timeCost: 3,
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export function encryptText(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKeyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.');
}

export function decryptText(cipherText: string): string {
  const [ivBase64, payloadBase64, authTagBase64] = cipherText.split('.');

  if (!ivBase64 || !payloadBase64 || !authTagBase64) {
    throw new Error('密文格式非法');
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKeyBuffer(),
    Buffer.from(ivBase64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadBase64, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signOpenApiPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function buildOpenApiCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, bodyHash].join(
    '\n',
  );
}
