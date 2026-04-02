import { Elysia } from 'elysia';

/**
 * 这里先提供一个轻量占位插件，主要用于保留统一鉴权扩展点。
 * 具体的后台 JWT、开放签名、内部 JWT 校验由 lib/auth 和各模块 guard 执行。
 */
export function createAuthPlugin() {
  return new Elysia({ name: 'auth-plugin' });
}
