import { t } from 'elysia';

export interface SuccessEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
}

export interface PageResult<T> {
  records: T[];
  pageNum: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OperationResult {
  resourceId: string;
  resourceType: string;
  status: string;
  operatedAt: string;
  operator: {
    userId: string;
    username: string;
    displayName: string;
  };
  remark?: string | null;
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
  records: T[],
  pageNum: number,
  pageSize: number,
  total: number,
): PageResult<T> {
  return {
    records,
    pageNum,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function parsePagination(query: Record<string, unknown>): {
  pageNum: number;
  pageSize: number;
} {
  const pageNum = Number(query.pageNum ?? 1);
  const pageSize = Number(query.pageSize ?? 20);

  return {
    pageNum: Number.isNaN(pageNum) || pageNum < 1 ? 1 : pageNum,
    pageSize: Number.isNaN(pageSize) || pageSize < 1 ? 20 : Math.min(pageSize, 100),
  };
}

export function parseOptionalDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseSort(
  query: Record<string, unknown>,
  defaultSortBy: string,
  defaultSortOrder: 'asc' | 'desc' = 'desc',
): { sortBy: string; sortOrder: 'asc' | 'desc' } {
  const sortBy =
    typeof query.sortBy === 'string' && query.sortBy.trim().length > 0
      ? query.sortBy.trim()
      : defaultSortBy;
  const sortOrder =
    typeof query.sortOrder === 'string' && query.sortOrder.toLowerCase() === 'asc'
      ? 'asc'
      : typeof query.sortOrder === 'string' && query.sortOrder.toLowerCase() === 'desc'
        ? 'desc'
        : defaultSortOrder;

  return {
    sortBy,
    sortOrder,
  };
}

export function buildOperationResult(input: {
  resourceId: string;
  resourceType: string;
  status: string;
  operator: OperationResult['operator'];
  remark?: string | null;
  operatedAt?: string;
}): OperationResult {
  return {
    resourceId: input.resourceId,
    resourceType: input.resourceType,
    status: input.status,
    operatedAt: input.operatedAt ?? new Date().toISOString(),
    operator: input.operator,
    remark: input.remark ?? null,
  };
}

export const SortOrderSchema = t.Union([t.Literal('asc'), t.Literal('desc')]);

export const BaseAdminListQuerySchema = t.Object({
  pageNum: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  keyword: t.Optional(t.String({ minLength: 1 })),
  status: t.Optional(t.String({ minLength: 1 })),
  startTime: t.Optional(t.String({ format: 'date-time' })),
  endTime: t.Optional(t.String({ format: 'date-time' })),
  sortBy: t.Optional(t.String({ minLength: 1 })),
  sortOrder: t.Optional(SortOrderSchema),
});

export const ErrorResponseSchema = t.Object({
  code: t.Number(),
  message: t.String(),
  data: t.Nullable(t.Any()),
  requestId: t.String(),
});

export function createSuccessResponseSchema(dataSchema: any) {
  return t.Object({
    code: t.Number({ default: 0 }),
    message: t.String({ default: 'success' }),
    data: dataSchema,
    requestId: t.String(),
  });
}

export function createPageDataSchema(recordSchema: any) {
  return t.Object({
    records: t.Array(recordSchema),
    pageNum: t.Number(),
    pageSize: t.Number(),
    total: t.Number(),
    totalPages: t.Number(),
  });
}

export function createPageResponseSchema(recordSchema: any) {
  return createSuccessResponseSchema(createPageDataSchema(recordSchema));
}

export const OperationResultSchema = t.Object({
  resourceId: t.String(),
  resourceType: t.String(),
  status: t.String(),
  operatedAt: t.String({ format: 'date-time' }),
  operator: t.Object({
    userId: t.String(),
    username: t.String(),
    displayName: t.String(),
  }),
  remark: t.Nullable(t.String()),
});
