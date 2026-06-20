// ============================================================
// 认证服务 — Token 黑名单测试（Redis 降级到内存模式）
// ============================================================

import { describe, it, expect } from "vitest";
import { addToBlacklist, isBlacklisted } from "../src/services/blacklistService.js";

describe("blacklistService (内存降级模式)", () => {
  it("加入黑名单后应能被检测到", async () => {
    const jti = "test-jti-001";
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 小时后过期

    await addToBlacklist(jti, futureExp);

    const result = await isBlacklisted(jti);
    expect(result).toBe(true);
  });

  it("未加入黑名单的 jti 应返回 false", async () => {
    const result = await isBlacklisted("never-added-jti");
    expect(result).toBe(false);
  });

  it("过期 jti 应返回 false（自动清理）", async () => {
    const jti = "expired-jti";
    const pastExp = Math.floor(Date.now() / 1000) - 60; // 60 秒前已过期

    await addToBlacklist(jti, pastExp);

    // 内存清理会检测过期
    const result = await isBlacklisted(jti);
    expect(result).toBe(false);
  });

  it("批量加入和查询", async () => {
    const jtis = ["jti-a", "jti-b", "jti-c"];
    const futureExp = Math.floor(Date.now() / 1000) + 3600;

    for (const jti of jtis) {
      await addToBlacklist(jti, futureExp);
    }

    for (const jti of jtis) {
      expect(await isBlacklisted(jti)).toBe(true);
    }

    expect(await isBlacklisted("jti-d")).toBe(false);
  });
});
