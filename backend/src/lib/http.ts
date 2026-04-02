export interface SuccessEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function ok<T>(requestId: string, data: T, message = 'success'): SuccessEnvelope<T> {
  return {
    code: 0,
    message,
    data,
    requestId,
  };
}

export function buildPageResult<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
): PageResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
  };
}

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);

  return {
    page: Number.isNaN(page) || page < 1 ? 1 : page,
    pageSize: Number.isNaN(pageSize) || pageSize < 1 ? 20 : Math.min(pageSize, 100),
  };
}
