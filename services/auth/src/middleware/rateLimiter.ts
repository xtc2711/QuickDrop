// ============================================================
// 认证服务 — 速率限制中间件
// 基于内存 + Redis（生产环境）的 IP 速率限制
// ============================================================

import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

interface RateLimitOptions {
  windowMs: number; // 时间窗口（毫秒）
  max: number; // 最大请求次数
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// 定期清理过期条目（每 60 秒）
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * 重置限流存储（仅用于测试）
 */
export function resetRateLimitStore(): void {
  store.clear();
}

export function rateLimitMiddleware(options: RateLimitOptions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `rate_limit:${req.ip}:${req.path}`;
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    if (entry.count > options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new AppError(429, `请求过于频繁，请在 ${retryAfter} 秒后重试`, {
        retry_after: retryAfter,
      });
    }

    next();
  };
}
