// ============================================================
// 信令服务 — 全局速率限制配置
// 所有限流参数可通过环境变量覆盖
// ============================================================

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

export interface SignalRateLimitOptions {
  windowMs: number;
  max: number;
}

export const signalRateLimitConfig = {
  /** 配对码加入验证 — 防止暴力破解配对码 */
  JOIN_PAIRING: {
    windowMs: envInt("SIGNAL_RATE_LIMIT_JOIN_PAIRING_WINDOW_MS", ONE_MINUTE),
    max: envInt("SIGNAL_RATE_LIMIT_JOIN_PAIRING_MAX", 5),
  } satisfies SignalRateLimitOptions,
} as const;

export function getSignalRateLimit(
  preset: keyof typeof signalRateLimitConfig,
): SignalRateLimitOptions {
  return { ...signalRateLimitConfig[preset] };
}
