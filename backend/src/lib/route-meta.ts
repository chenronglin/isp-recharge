import { extractClientIp, generateRequestId } from '@/lib/request';

export function getRequestIdFromRequest(request: Request): string {
  return request.headers.get('x-request-id') ?? generateRequestId();
}

export function getClientIpFromRequest(request: Request): string {
  return extractClientIp(request.headers);
}
