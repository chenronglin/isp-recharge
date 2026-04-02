/**
 * 时间工具统一放在这里，避免各模块各写一套时间格式化逻辑。
 */
export function now(): Date {
  return new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
