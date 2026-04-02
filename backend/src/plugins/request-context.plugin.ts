import { Elysia } from 'elysia';

import { extractClientIp, generateRequestId } from '@/lib/request';

/**
 * 为每个请求注入 requestId / traceId / clientIp。
 * 后续所有响应、审计、日志都统一依赖这里的上下文。
 */
export function createRequestContextPlugin() {
  return new Elysia({ name: 'request-context-plugin' }).derive(({ headers, request, set }) => {
    const requestId = headers['x-request-id'] ?? generateRequestId();
    const traceId = headers['x-trace-id'] ?? requestId;
    const clientIp = extractClientIp(request.headers);

    set.headers['x-request-id'] = requestId;
    set.headers['x-trace-id'] = traceId;

    return {
      requestId,
      traceId,
      clientIp,
    };
  });
}
