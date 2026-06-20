// ============================================================
// 信令服务 — WebRTC 信令透传处理器测试
// 覆盖：offer/answer/ICE candidate 转发、target 校验、离线处理
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WsJwtPayload } from "../src/middleware/authMiddleware.js";
import type { WsMessage } from "../src/models/types.js";

// Mock deviceManager
const mockSendToDevice = vi.fn();
vi.mock("../src/services/deviceManager.js", () => ({
  deviceManager: {
    sendToDevice: (...args: unknown[]) => mockSendToDevice(...args),
  },
}));

import { handleSignalingMessage } from "../src/handlers/signalingHandler.js";
import { mockWebSocket } from "./setup.js";

function mockSender(overrides = {}): WsJwtPayload {
  return {
    sub: "user-001",
    device_id: "device-sender",
    jti: "jti-001",
    iat: 1234567890,
    exp: 9999999999,
    ...overrides,
  };
}

function mockSignalingMessage(type: string, target: string, extraPayload = {}): WsMessage {
  return {
    type,
    target,
    payload: {
      sdp: type === "offer" ? "v=0\r\no=- ..." : undefined,
      candidate: type === "ice_candidate" ? "candidate:1 1 UDP ..." : undefined,
      ...extraPayload,
    },
    timestamp: new Date().toISOString(),
  };
}

describe("handleSignalingMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendToDevice.mockReturnValue(true);
  });

  // ============================================================
  // offer 转发
  // ============================================================
  describe("offer 转发", () => {
    it("应向目标设备透传 offer 并附带 from_device_id", () => {
      const ws = mockWebSocket();
      const sender = mockSender();
      const msg = mockSignalingMessage("offer", "device-target", {
        sdp: "v=0\r\no=mozilla...",
      });

      handleSignalingMessage(ws, sender, msg);

      expect(mockSendToDevice).toHaveBeenCalledWith("device-target", {
        type: "offer",
        payload: {
          sdp: "v=0\r\no=mozilla...",
          from_device_id: "device-sender",
        },
        timestamp: expect.any(String),
      });
      // 不应向发送方返回错误
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // answer 转发
  // ============================================================
  describe("answer 转发", () => {
    it("应向目标设备透传 answer 并附带 from_device_id", () => {
      const ws = mockWebSocket();
      const sender = mockSender();
      const msg = mockSignalingMessage("answer", "device-target", {
        sdp: "v=0\r\no=chrome...",
      });

      handleSignalingMessage(ws, sender, msg);

      expect(mockSendToDevice).toHaveBeenCalledWith("device-target", {
        type: "answer",
        payload: {
          sdp: "v=0\r\no=chrome...",
          from_device_id: "device-sender",
        },
        timestamp: expect.any(String),
      });
    });
  });

  // ============================================================
  // ICE candidate 转发
  // ============================================================
  describe("ICE candidate 转发", () => {
    it("应向目标设备透传 ICE candidate 并附带 from_device_id", () => {
      const ws = mockWebSocket();
      const sender = mockSender();
      const msg = mockSignalingMessage("ice_candidate", "device-target", {
        candidate: "candidate:1 1 UDP 2130706431 10.0.0.1 52314 typ host",
      });

      handleSignalingMessage(ws, sender, msg);

      expect(mockSendToDevice).toHaveBeenCalledWith("device-target", {
        type: "ice_candidate",
        payload: {
          candidate: "candidate:1 1 UDP 2130706431 10.0.0.1 52314 typ host",
          from_device_id: "device-sender",
        },
        timestamp: expect.any(String),
      });
    });
  });

  // ============================================================
  // 错误处理
  // ============================================================
  describe("错误处理", () => {
    it("缺少 target 字段时应返回错误消息", () => {
      const ws = mockWebSocket();
      const sender = mockSender();
      const msg: WsMessage = {
        type: "offer",
        payload: { sdp: "test" },
        timestamp: new Date().toISOString(),
      };

      handleSignalingMessage(ws, sender, msg);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const errorMsg = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorMsg.type).toBe("error");
      expect(errorMsg.payload.message).toContain("缺少 target");
      expect(mockSendToDevice).not.toHaveBeenCalled();
    });

    it("目标设备不在线时应返回错误消息", () => {
      const ws = mockWebSocket();
      const sender = mockSender();
      const msg = mockSignalingMessage("offer", "offline-device");
      mockSendToDevice.mockReturnValue(false);

      handleSignalingMessage(ws, sender, msg);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const errorMsg = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorMsg.type).toBe("error");
      expect(errorMsg.payload.message).toContain("目标设备不在线");
    });
  });
});
