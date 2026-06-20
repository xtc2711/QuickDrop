// ============================================================
// 认证服务 — Redis 客户端连接
// ============================================================

import { createClient, type RedisClientType } from "redis";

let redisClient: RedisClientType | null = null;

/**
 * 获取 Redis 客户端单例
 * 仅在 REDIS_URL 配置时创建连接，否则返回 null
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    return null;
  }

  if (redisClient?.isOpen) {
    return redisClient;
  }

  try {
    redisClient = createClient({ url: redisUrl });

    redisClient.on("error", (err) => {
      console.error("Redis client error:", err.message);
    });

    await redisClient.connect();
    console.log("📦 Redis connected");
    return redisClient;
  } catch (err) {
    console.warn("⚠️  Redis 不可用，部分功能降级（Token 黑名单、速率限制）:", (err as Error).message);
    redisClient = null;
    return null;
  }
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}
