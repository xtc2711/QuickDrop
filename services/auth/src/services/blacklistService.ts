// ============================================================
// 认证服务 — Token 黑名单服务
// 使用 Redis 存储被撤销的 JWT jti，实现即时 Token 失效
// Redis 不可用时降级为内存存储（仅当前进程生效）
// ============================================================

import { getRedisClient } from "../utils/redis.js";

const BLACKLIST_PREFIX = "token_blacklist:";

// 内存降级存储
const memoryBlacklist = new Map<string, number>(); // jti → expiresAt timestamp

// 定期清理过期条目（每 60 秒）
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiresAt] of memoryBlacklist) {
    if (expiresAt <= now) {
      memoryBlacklist.delete(jti);
    }
  }
}, 60_000);

/**
 * 将 JWT jti 加入黑名单
 * @param jti Token 唯一标识
 * @param expiresAt Token 过期时间戳（秒），黑名单保留到此时间
 */
export async function addToBlacklist(jti: string, expiresAt: number): Promise<void> {
  const redis = await getRedisClient();

  const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000);

  // 已过期的 Token 不需要加入黑名单
  if (ttlSeconds <= 0) return;

  if (redis) {
    // Redis: 设置 key 的过期时间为 Token 剩余有效期
    const key = `${BLACKLIST_PREFIX}${jti}`;
    await redis.set(key, "1", { EX: ttlSeconds });
  } else {
    // 内存降级
    memoryBlacklist.set(jti, Date.now() + ttlSeconds * 1000);
  }
}

/**
 * 检查 jti 是否在黑名单中
 * @returns true 表示 Token 已被撤销
 */
export async function isBlacklisted(jti: string): Promise<boolean> {
  const redis = await getRedisClient();

  if (redis) {
    const key = `${BLACKLIST_PREFIX}${jti}`;
    const result = await redis.exists(key);
    return result === 1;
  }

  // 内存降级：清理过期后检查
  const expiresAt = memoryBlacklist.get(jti);
  if (expiresAt && expiresAt > Date.now()) {
    return true;
  }
  if (expiresAt) {
    memoryBlacklist.delete(jti);
  }
  return false;
}
