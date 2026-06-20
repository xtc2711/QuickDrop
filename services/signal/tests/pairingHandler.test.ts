// ============================================================
// 信令服务 — 配对处理器测试
// 覆盖：配对码创建、扫码配对、加入配对、限速、错误处理
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WsJwtPayload } from "../src/middleware/authMiddleware.js";
import type { WsMessage } from "../src/models/types.js";

// Mock 依赖
const mockCreatePairingCode = vi.fn();
const mockCreateQRPairing = vi.fn();
const mockJoinByCode = vi.fn();
const mockJoinByRoom = vi.fn();

vi.mock("../src/services/pairingService.js", () => ({
  pairingService: {
    createPairingCode: (...args: unknown[]) => mockCreatePairingCode(...args),
    createQRPairing: (...args: unknown[]) => mockCreateQRPairing(...args),
    joinByCode: (...args: unknown[]) => mockJoinByCode(...args),
    joinByRoom: (...args: unknown[]) => mockJoinByRoom(...args),
  },
}));

const mockGetDevice = vi.fn();
const mockSendToDevice = vi.fn();

vi.mock("../src/services/deviceManager.js", () => ({
  deviceManager: {
    get: (...args: unknown[]) => mockGetDevice(...args),
    sendToDevice: (...args: unknown[]) => mockSendToDevice(...args),
  },
}));

import { handlePairingMessage } from "../src/handlers/pairingHandler.js";
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

describe("handlePairingMessage", () => {
  let ws: ReturnType<typeof mockWebSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    ws = mockWebSocket();
  });

  // ============================================================
  // create_pairing_code
  // ============================================================
  describe("create_pairing_code", () => {
    it("应创建配对码并返回给请求设备", () => {
      const expiresAt = new Date(Date.now() + 120_000);
      mockCreatePairingCode.mockReturnValue({
        code: "427891",
        roomId: "room-001",
        expiresAt,
      });

      const msg: WsMessage = {
        type: "create_pairing_code",
        payload: {},
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      expect(mockCreatePairingCode).toHaveBeenCalledWith("device-sender");
      expect(ws.send).toHaveBeenCalledTimes(1);
      const response = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(response.type).toBe("pairing_code_created");
      expect(response.payload.code).toBe("427891");
      expect(response.payload.room_id).toBe("room-001");
      expect(response.payload.expires_in).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // create_pairing_qr
  // ============================================================
  describe("create_pairing_qr", () => {
    it("应创建扫码配对并返回二维码数据", () => {
      const expiresAt = new Date(Date.now() + 120_000);
      mockCreateQRPairing.mockReturnValue({
        qrData: '{"type":"quickdrop_pairing","room_id":"room-qr-001"}',
        roomId: "room-qr-001",
        expiresAt,
      });

      const msg: WsMessage = {
        type: "create_pairing_qr",
        payload: {},
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      expect(mockCreateQRPairing).toHaveBeenCalledWith("device-sender");
      expect(ws.send).toHaveBeenCalledTimes(1);
      const response = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(response.type).toBe("pairing_qr_created");
      expect(response.payload.qr_data).toContain("quickdrop_pairing");
    });
  });

  // ============================================================
  // join_pairing — 通过配对码
  // ============================================================
  describe("join_pairing（配对码）", () => {
    it("有效配对码应配对成功，通知双方", () => {
      mockGetDevice.mockReturnValue({
        deviceName: "iPhone 16",
        deviceType: "phone",
        os: "ios",
      });
      mockJoinByCode.mockReturnValue({
        roomId: "room-001",
        creatorDeviceId: "creator-device-001",
      });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: {
          code: "427891",
          device_name: "iPhone 16",
          device_type: "phone",
          os: "ios",
        },
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      // 加入方收到成功消息
      const joinResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(joinResponse.type).toBe("pairing_success");
      expect(joinResponse.payload.peer_device_id).toBe("creator-device-001");

      // 创建方收到新设备加入通知
      expect(mockSendToDevice).toHaveBeenCalledWith("creator-device-001", {
        type: "peer_join",
        payload: {
          device_id: "device-sender",
          device_name: "iPhone 16",
          device_type: "phone",
          os: "ios",
          room_id: "room-001",
        },
        timestamp: expect.any(String),
      });
    });

    it("无效配对码应返回错误", () => {
      mockGetDevice.mockReturnValue(null);
      mockJoinByCode.mockReturnValue({ error: "配对码无效" });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: { code: "000000" },
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      const errorResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorResponse.type).toBe("error");
      expect(errorResponse.payload.message).toBe("配对码无效");
    });

    it("已过期配对码应返回错误", () => {
      mockGetDevice.mockReturnValue(null);
      mockJoinByCode.mockReturnValue({ error: "配对码已过期" });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: { code: "111222" },
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      const errorResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorResponse.type).toBe("error");
      expect(errorResponse.payload.message).toBe("配对码已过期");
    });
  });

  // ============================================================
  // join_pairing — 通过 room_id（扫码）
  // ============================================================
  describe("join_pairing（扫码 room_id）", () => {
    it("有效 room_id 应配对成功", () => {
      mockGetDevice.mockReturnValue({
        deviceName: "Android Phone",
        deviceType: "phone",
        os: "android",
      });
      mockJoinByRoom.mockReturnValue({
        creatorDeviceId: "creator-qr-001",
      });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: {
          room_id: "room-qr-001",
          device_name: "Android Phone",
          device_type: "phone",
          os: "android",
        },
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      const joinResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(joinResponse.type).toBe("pairing_success");
      expect(joinResponse.payload.peer_device_id).toBe("creator-qr-001");
    });

    it("缺少 code 和 room_id 时应返回错误", () => {
      const msg: WsMessage = {
        type: "join_pairing",
        payload: {},
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      const errorResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorResponse.type).toBe("error");
      expect(errorResponse.payload.message).toContain("请提供配对码");
    });
  });

  // ============================================================
  // join_pairing — 限速
  // ============================================================
  describe("join_pairing（限速）", () => {
    it("超过 5 次/60秒 频率限制应返回错误", () => {
      mockGetDevice.mockReturnValue(null);
      mockJoinByCode.mockReturnValue({ error: "配对码无效" });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: { code: "111111" },
        timestamp: new Date().toISOString(),
      };

      // 连续 6 次调用
      for (let i = 0; i < 6; i++) {
        handlePairingMessage(ws, mockSender(), msg);
      }

      // 第 6 次应被限速
      const calls = vi.mocked(ws.send).mock.calls;
      const lastMsg = JSON.parse(calls[calls.length - 1]?.[0] as string);
      expect(lastMsg.type).toBe("error");
      expect(lastMsg.payload.message).toContain("过于频繁");
    });

    it("不同用户应分别计数", () => {
      mockGetDevice.mockReturnValue(null);
      mockJoinByCode.mockReturnValue({ error: "配对码无效" });

      const msg: WsMessage = {
        type: "join_pairing",
        payload: { code: "111111" },
        timestamp: new Date().toISOString(),
      };

      // 用户 1：6 次
      for (let i = 0; i < 6; i++) {
        handlePairingMessage(ws, mockSender({ sub: "user-001" }), msg);
      }

      const ws2 = mockWebSocket();
      // 用户 2：5 次（不应被限速）
      for (let i = 0; i < 5; i++) {
        handlePairingMessage(ws2, mockSender({ sub: "user-002", device_id: "device-002" }), msg);
      }

      // 用户 1 的最后一条应是限速错误
      const user1Calls = vi.mocked(ws.send).mock.calls;
      const user1Last = JSON.parse(user1Calls[user1Calls.length - 1]?.[0] as string);
      expect(user1Last.payload.message).toContain("过于频繁");

      // 用户 2 的调用不应包含限速错误
      const user2LastCall = vi.mocked(ws2.send).mock.calls[4]?.[0] as string;
      const user2Last = JSON.parse(user2LastCall);
      expect(user2Last.type).toBe("error");
      expect(user2Last.payload.message).toBe("配对码无效"); // 正常错误，非限速
    });
  });

  // ============================================================
  // 未知消息类型
  // ============================================================
  describe("未知消息类型", () => {
    it("应返回未知消息类型错误", () => {
      const msg: WsMessage = {
        type: "unknown_action",
        payload: {},
        timestamp: new Date().toISOString(),
      };

      handlePairingMessage(ws, mockSender(), msg);

      const errorResponse = JSON.parse(vi.mocked(ws.send).mock.calls[0]?.[0] as string);
      expect(errorResponse.type).toBe("error");
      expect(errorResponse.payload.message).toContain("未知的配对消息类型");
    });
  });
});
