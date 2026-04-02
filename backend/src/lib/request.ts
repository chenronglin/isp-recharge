import { generateBusinessNo } from '@/lib/id';

export function extractClientIp(headers: Headers): string {
  return headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? '127.0.0.1';
}

export function generateRequestId(): string {
  return generateBusinessNo('req');
}

export function extractBearerToken(authorization?: string | null): string | null {
  if (!authorization) {
    return null;
  }

  if (!authorization.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length);
}
