// ============================================================
// 信令服务 — WebSocket JWT 认证中间件测试
// 覆盖：Token 提取（query string / Sec-WebSocket-Protocol）、JWT 验证
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import type { IncomingMessage } from "http";

// 注意：authenticateWebSocket 需在 mock 之后动态导入
async function getAuthMiddleware() {
  return await import("../src/middleware/authMiddleware.js");
}

function mockReq(overrides: {
  url?: string;
  host?: string;
  protocolHeader?: string;
} = {}): IncomingMessage {
  const headers: Record<string, string> = {};
  if (overrides.protocolHeader) {
    headers["sec-websocket-protocol"] = overrides.protocolHeader;
  }

  return {
    url: overrides.url || "/",
    headers: {
      host: overrides.host || "localhost:3002",
      ...headers,
    },
  } as IncomingMessage;
}

describe("authenticateWebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Token 来源：query string
  // ============================================================
  describe("从 query string 提取 Token", () => {
    it("有效 Token 应返回解析后的 payload", async () => {
      const payload = {
        sub: "user-001",
        device_id: "device-001",
        jti: "jti-001",
        iat: 1234567890,
        exp: 9999999999,
      };
      vi.mocked(jwt.verify).mockReturnValue(payload as never);

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({ url: "/ws?token=valid.jwt.token" });

      const result = authenticateWebSocket(req);
      expect(result).toEqual(payload);
      expect(jwt.verify).toHaveBeenCalledWith("valid.jwt.token", expect.any(String));
    });

    it("无 Token 时应返回 null", async () => {
      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({ url: "/ws" });

      const result = authenticateWebSocket(req);
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // Token 来源：Sec-WebSocket-Protocol header
  // ============================================================
  describe("从 Sec-WebSocket-Protocol header 提取 Token", () => {
    it("应正确提取并验证 access_token.<value> 协议", async () => {
      const payload = {
        sub: "user-002",
        device_id: "device-002",
        jti: "jti-002",
        iat: 1234567890,
        exp: 9999999999,
      };
      vi.mocked(jwt.verify).mockReturnValue(payload as never);

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({
        url: "/ws",
        protocolHeader: "access_token.my.jwt.token",
      });

      const result = authenticateWebSocket(req);
      expect(result).toEqual(payload);
      expect(jwt.verify).toHaveBeenCalledWith("my.jwt.token", expect.any(String));
    });

    it("多个协议时应在列表中查找 access_token.* 协议", async () => {
      const payload = {
        sub: "user-003",
        device_id: "device-003",
        jti: "jti-003",
        iat: 1234567890,
        exp: 9999999999,
      };
      vi.mocked(jwt.verify).mockReturnValue(payload as never);

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({
        url: "/ws",
        protocolHeader: "json, access_token.my.jwt.token, another-protocol",
      });

      const result = authenticateWebSocket(req);
      expect(result).toEqual(payload);
    });

    it("header 中有协议但不是 access_token.* 前缀时应返回 null", async () => {
      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({
        url: "/ws",
        protocolHeader: "json, another-protocol",
      });

      const result = authenticateWebSocket(req);
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // Token 验证失败
  // ============================================================
  describe("Token 验证失败", () => {
    it("无效 Token（jwt.verify 抛出异常）应返回 null", async () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new Error("invalid token");
      });

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({ url: "/ws?token=invalid.token" });

      const result = authenticateWebSocket(req);
      expect(result).toBeNull();
    });

    it("Token 过期（TokenExpiredError）应返回 null", async () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new jwt.TokenExpiredError();
      });

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({ url: "/ws?token=expired.token" });

      const result = authenticateWebSocket(req);
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // 优先级：query string > header
  // ============================================================
  describe("Token 来源优先级", () => {
    it("query string 中的 Token 应优先于 header", async () => {
      const payload = {
        sub: "user-004",
        device_id: "device-004",
        jti: "jti-004",
        iat: 1234567890,
        exp: 9999999999,
      };
      vi.mocked(jwt.verify).mockReturnValue(payload as never);

      const { authenticateWebSocket } = await getAuthMiddleware();
      const req = mockReq({
        url: "/ws?token=query.token",
        protocolHeader: "access_token.header.token",
      });

      const result = authenticateWebSocket(req);
      expect(result).toEqual(payload);
      // 应优先使用 query string 中的 token
      expect(jwt.verify).toHaveBeenCalledWith("query.token", expect.any(String));
    });
  });
});
