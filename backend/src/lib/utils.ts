/**
 * 通用小工具。
 * 这里优先提供平台级需要复用的基础能力，避免每个模块重复实现。
 */
export function stableStringify(input: unknown): string {
  if (input === null || input === undefined) {
    return '';
  }

  if (typeof input !== 'object') {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  }

  const object = input as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  const content = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',');

  return `{${content}}`;
}

export function toJsonObject<T extends Record<string, unknown>>(input: T): string {
  return JSON.stringify(input);
}

export function isNil(value: unknown): boolean {
  return value === null || value === undefined;
}

export function parseJsonValue<T>(input: unknown, fallback: T): T {
  if (input === null || input === undefined) {
    return fallback;
  }

  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as T;
    } catch {
      return fallback;
    }
  }

  return input as T;
}

export function toIsoDateTime(input: string | Date | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const date = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function toAmountFen(input: number | null | undefined): number | null {
  if (input === null || input === undefined) {
    return null;
  }

  return Math.round(Number(input) * 100);
}
