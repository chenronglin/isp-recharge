/**
 * 所有主键、业务号都尽量用 Bun 原生 UUIDv7，便于数据库索引按时间排序。
 */
export function generateId(): string {
  return Bun.randomUUIDv7();
}

export function generateBusinessNo(prefix: string): string {
  const compact = generateId().replaceAll('-', '');
  return `${prefix}_${compact}`;
}
