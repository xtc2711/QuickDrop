// ============================================================
// 信令服务 — 测试环境设置
// Mock WebSocket、JWT、uuid，避免依赖真实网络
// ============================================================

import { vi, beforeEach } from "vitest";

// ---------- Mock WebSocket 工厂 ----------

export function mockWebSocket(readyState = 1) {
  return {
    // WebSocket 常量
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    readyState, // 默认 OPEN
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as import("ws").WebSocket;
}

// ---------- Mock JWT ----------

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
    TokenExpiredError: class TokenExpiredError extends Error {
      constructor() {
        super("jwt expired");
        this.name = "TokenExpiredError";
      }
    },
  },
}));

// ---------- Mock uuid ----------

vi.mock("uuid", () => ({
  v4: vi.fn(() => "mock-room-uuid-001"),
}));

// ---------- 设置测试环境变量 ----------

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.HEARTBEAT_INTERVAL_MS = "100";
process.env.HEARTBEAT_TIMEOUT_MS = "200";

// ---------- 每个测试前重置所有 mock ----------

beforeEach(() => {
  vi.clearAllMocks();
});
