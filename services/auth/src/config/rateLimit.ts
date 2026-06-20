// ============================================================
// 认证服务 — 全局速率限制配置
// 所有限流参数可通过环境变量覆盖，生产环境建议适当收紧
// ============================================================

import type { RateLimitOptions } from "../middleware/rateLimiter.js";

/**
 * 从环境变量读取数值，带默认值回退
 */
function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

const ONE_MINUTE = 60_000;
const ONE_HOUR = 3600_000;

/**
 * 命名限流预设 — 每个端点独立配置
 *
 * 路径前缀 /api/v1/auth 由中间件自动提取，
 * 实际存储 key 为 `rate_limit:<ip>:<path>`（不含前缀），
 * 所以注册 /register 和登录 /login 的计数器是独立的。
 */
export const rateLimitConfig = {
  /** POST /register — 注册接口，防止批量注册 */
  REGISTER: {
    windowMs: envInt("RATE_LIMIT_REGISTER_WINDOW_MS", ONE_HOUR),
    max: envInt("RATE_LIMIT_REGISTER_MAX", 5),
  } satisfies RateLimitOptions,

  /** POST /login — 登录接口，防暴力破解 */
  LOGIN: {
    windowMs: envInt("RATE_LIMIT_LOGIN_WINDOW_MS", ONE_MINUTE),
    max: envInt("RATE_LIMIT_LOGIN_MAX", 10),
  } satisfies RateLimitOptions,

  /** POST /change-password — 修改密码，低频操作 */
  CHANGE_PASSWORD: {
    windowMs: envInt("RATE_LIMIT_CHANGE_PASSWORD_WINDOW_MS", ONE_MINUTE),
    max: envInt("RATE_LIMIT_CHANGE_PASSWORD_MAX", 3),
  } satisfies RateLimitOptions,

  /** POST /forgot-password — 密码重置请求，防滥用 */
  FORGOT_PASSWORD: {
    windowMs: envInt("RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MS", ONE_HOUR),
    max: envInt("RATE_LIMIT_FORGOT_PASSWORD_MAX", 3),
  } satisfies RateLimitOptions,

  /** POST /reset-password — 重置密码，防止暴力尝试 */
  RESET_PASSWORD: {
    windowMs: envInt("RATE_LIMIT_RESET_PASSWORD_WINDOW_MS", ONE_HOUR),
    max: envInt("RATE_LIMIT_RESET_PASSWORD_MAX", 5),
  } satisfies RateLimitOptions,
} as const;

/**
 * 获取指定端点的限流配置（浅拷贝，允许调用方消费）
 */
export function getRateLimit(
  preset: keyof typeof rateLimitConfig,
): RateLimitOptions {
  return { ...rateLimitConfig[preset] };
}
