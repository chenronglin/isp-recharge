/**
 * 当前阶段先使用轻量日志封装。
 * 后续若接入更完善的日志系统，只需要替换这里即可，不影响业务代码。
 */
type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, payload?: unknown): void {
  const line = {
    level,
    message,
    payload,
    timestamp: new Date().toISOString(),
  };

  if (level === 'error') {
    console.error(JSON.stringify(line));
    return;
  }

  console.log(JSON.stringify(line));
}

export const logger = {
  info(message: string, payload?: unknown): void {
    write('info', message, payload);
  },
  warn(message: string, payload?: unknown): void {
    write('warn', message, payload);
  },
  error(message: string, payload?: unknown): void {
    write('error', message, payload);
  },
};
