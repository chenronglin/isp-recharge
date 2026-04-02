export class AppError extends Error {
  public readonly status: number;
  public readonly code: number;
  public readonly details?: unknown;

  constructor(status: number, code: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 1000, message, details);
}

export function unauthorized(message = '未授权访问'): AppError {
  return new AppError(401, 2000, message);
}

export function forbidden(message = '没有访问权限'): AppError {
  return new AppError(403, 3000, message);
}

export function notFound(message = '资源不存在'): AppError {
  return new AppError(404, 4040, message);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, 4090, message, details);
}

export function systemError(message = '系统内部错误', details?: unknown): AppError {
  return new AppError(500, 9000, message, details);
}
