import { Elysia } from 'elysia';

import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRequestIdFromRequest } from '@/lib/route-meta';

/**
 * 统一错误输出格式，保证所有接口都遵循 `code/message/data/requestId` 协议。
 */
export function createErrorPlugin() {
  return new Elysia({ name: 'error-plugin' }).onError(({ code, error, request, set }) => {
    const requestId = getRequestIdFromRequest(request);

    if (error instanceof AppError) {
      set.status = error.status;
      return {
        code: error.code,
        message: error.message,
        data: error.details ?? null,
        requestId,
      };
    }

    logger.error('未捕获异常', {
      code,
      error,
      requestId,
    });

    set.status = 500;
    return {
      code: 9000,
      message: '系统内部错误',
      data: null,
      requestId,
    };
  });
}
