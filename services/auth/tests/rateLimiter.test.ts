// ============================================================
// 认证服务 — 速率限制中间件测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimitMiddleware, resetRateLimitStore } from "../src/middleware/rateLimiter.js";
import type { Request, Response, NextFunction } from "express";

function mockReq(ip = "127.0.0.1", path = "/api/v1/auth/login"): Request {
  return {
    ip,
    path,
  } as unknown as Request;
}

function mockRes(): Response {
  return {} as Response;
}

describe("rateLimitMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
  });

  it("在限制内应正常放行", () => {
    const middleware = rateLimitMiddleware({ windowMs: 60_000, max: 5 });
    const next = vi.fn() as NextFunction;

    // 连续调用 5 次
    for (let i = 0; i < 5; i++) {
      middleware(mockReq(), mockRes(), next);
    }

    // 所有调用都应通过
    expect(next).toHaveBeenCalledTimes(5);
    expect(next).toHaveBeenCalledWith(); // 无参数调用表示无错误
  });

  it("超过限制应返回 429", () => {
    const middleware = rateLimitMiddleware({ windowMs: 60_000, max: 5 });
    const next = vi.fn() as NextFunction;

    // 消耗所有配额
    for (let i = 0; i < 5; i++) {
      middleware(mockReq(), mockRes(), next);
    }

    // 第 6 次应抛出 AppError
    let caught: Error | null = null;
    try {
      middleware(mockReq(), mockRes(), next);
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBeTruthy();
    expect(caught!.message).toContain("请求过于频繁");
    expect(caught).toHaveProperty("statusCode", 429);
  });

  it("不同 IP 应分别计数", () => {
    const middleware = rateLimitMiddleware({ windowMs: 60_000, max: 3 });
    const next = vi.fn() as NextFunction;

    // IP-1: 3 次，不超限
    for (let i = 0; i < 3; i++) {
      middleware(mockReq("192.168.1.1"), mockRes(), next);
    }

    // IP-2: 3 次，不超限
    for (let i = 0; i < 3; i++) {
      middleware(mockReq("192.168.1.2"), mockRes(), next);
    }

    // IP-1: 第 4 次应超限
    let caught: Error | null = null;
    try {
      middleware(mockReq("192.168.1.1"), mockRes(), next);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain("请求过于频繁");
  });

  it("注册接口限流 5 次/小时", () => {
    const middleware = rateLimitMiddleware({ windowMs: 3600_000, max: 5 });
    const next = vi.fn() as NextFunction;

    for (let i = 0; i < 5; i++) {
      middleware(mockReq("10.0.0.1", "/api/v1/auth/register"), mockRes(), next);
    }

    let caught: Error | null = null;
    try {
      middleware(mockReq("10.0.0.1", "/api/v1/auth/register"), mockRes(), next);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain("请求过于频繁");
  });

  it("登录接口限流 10 次/分钟", () => {
    const middleware = rateLimitMiddleware({ windowMs: 60_000, max: 10 });
    const next = vi.fn() as NextFunction;

    for (let i = 0; i < 10; i++) {
      middleware(mockReq("10.0.0.2", "/api/v1/auth/login"), mockRes(), next);
    }

    let caught: Error | null = null;
    try {
      middleware(mockReq("10.0.0.2", "/api/v1/auth/login"), mockRes(), next);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain("请求过于频繁");
  });
});
