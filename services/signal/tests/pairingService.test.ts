// ============================================================
// 信令服务 — 配对服务单元测试
// 覆盖：配对码创建、扫码配对、加入配对、过期处理、防自配对
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { PairingService } from "../src/services/pairingService.js";

// 控制 uuid 返回值以区分不同房间
let uuidCounter = 0;
vi.mocked(uuidv4).mockImplementation(() => `room-${++uuidCounter}`);

describe("PairingService", () => {
  let ps: PairingService;

  beforeEach(() => {
    vi.useFakeTimers();
    uuidCounter = 0;
    ps = new PairingService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // createPairingCode() — 创建配对码
  // ============================================================
  describe("createPairingCode()", () => {
    it("应生成 6 位配对码和房间 ID", () => {
      const result = ps.createPairingCode("creator-device-001");

      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.roomId).toBe("room-1");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("生成的配对码不应是弱密码（如 000000、123456 等）", () => {
      // 多次生成验证都排除弱密码
      for (let i = 0; i < 10; i++) {
        const { code } = ps.createPairingCode(`device-${i}`);
        const weakCodes = ["000000", "111111", "222222", "333333", "123456"];
        expect(weakCodes).not.toContain(code);
      }
    });

    it("有效期应为 2 分钟", () => {
      const result = ps.createPairingCode("device-001");
      const ttl = result.expiresAt.getTime() - Date.now();
      expect(ttl).toBe(2 * 60 * 1000);
    });

    it("应能通过 getRoom 获取房间信息", () => {
      const { roomId } = ps.createPairingCode("device-001");
      const room = ps.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room!.creatorDeviceId).toBe("device-001");
      expect(room!.used).toBe(false);
    });
  });

  // ============================================================
  // createQRPairing() — 创建扫码配对
  // ============================================================
  describe("createQRPairing()", () => {
    it("应生成包含 room_id 的二维码数据", () => {
      const result = ps.createQRPairing("device-001");

      const qrData = JSON.parse(result.qrData);
      expect(qrData.type).toBe("quickdrop_pairing");
      expect(qrData.room_id).toBe("room-1");
      expect(qrData.expires_at).toBeTruthy();
    });

    it("有效期应为 2 分钟", () => {
      const result = ps.createQRPairing("device-001");
      const ttl = result.expiresAt.getTime() - Date.now();
      expect(ttl).toBe(2 * 60 * 1000);
    });

    it("应能通过 getRoom 获取房间信息", () => {
      const { roomId } = ps.createQRPairing("device-001");
      const room = ps.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room!.code).toBeUndefined(); // 扫码房间无配对码
    });
  });

  // ============================================================
  // joinByCode() — 通过配对码加入
  // ============================================================
  describe("joinByCode()", () => {
    it("有效配对码应加入成功，返回房间信息", () => {
      const { code } = ps.createPairingCode("creator-001");

      const result = ps.joinByCode(code, "joiner-001");

      expect("roomId" in result).toBe(true);
      if ("roomId" in result) {
        expect(result.creatorDeviceId).toBe("creator-001");
      }
      // 标记为已使用
      const room = ps.getRoom("room-1");
      expect(room!.used).toBe(true);
      expect(room!.joinedDeviceId).toBe("joiner-001");
    });

    it("无效配对码应返回错误", () => {
      const result = ps.joinByCode("999999", "joiner-001");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("配对码无效");
      }
    });

    it("已过期的配对码应返回错误", () => {
      const { code } = ps.createPairingCode("creator-001");

      // 推进时间超过 2 分钟
      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const result = ps.joinByCode(code, "joiner-001");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("过期");
      }
    });

    it("已使用的配对码应返回错误（一次性使用）", () => {
      const { code } = ps.createPairingCode("creator-001");

      // 第一次使用
      ps.joinByCode(code, "joiner-001");
      // 第二次使用同一码
      const result = ps.joinByCode(code, "joiner-002");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("已被使用");
      }
    });

    it("不能配对到自己的设备", () => {
      const { code } = ps.createPairingCode("creator-001");

      const result = ps.joinByCode(code, "creator-001");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("不能与自己的设备配对");
      }
    });
  });

  // ============================================================
  // joinByRoom() — 通过房间 ID 加入（扫码配对）
  // ============================================================
  describe("joinByRoom()", () => {
    it("有效房间 ID 应加入成功", () => {
      const { roomId } = ps.createQRPairing("creator-001");

      const result = ps.joinByRoom(roomId, "joiner-001");

      expect("creatorDeviceId" in result).toBe(true);
      if ("creatorDeviceId" in result) {
        expect(result.creatorDeviceId).toBe("creator-001");
      }
      // 标记为已使用
      const room = ps.getRoom(roomId);
      expect(room!.used).toBe(true);
    });

    it("不存在的房间应返回错误", () => {
      const result = ps.joinByRoom("nonexistent-room", "joiner-001");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("配对房间不存在");
      }
    });

    it("已过期的房间应返回错误", () => {
      const { roomId } = ps.createQRPairing("creator-001");

      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const result = ps.joinByRoom(roomId, "joiner-001");
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("过期");
      }
    });

    it("已使用的房间应返回错误", () => {
      const { roomId } = ps.createQRPairing("creator-001");

      ps.joinByRoom(roomId, "joiner-001");
      const result = ps.joinByRoom(roomId, "joiner-002");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("已被使用");
      }
    });

    it("不能配对到自己的设备", () => {
      const { roomId } = ps.createQRPairing("creator-001");

      const result = ps.joinByRoom(roomId, "creator-001");

      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("不能与自己的设备配对");
      }
    });
  });

  // ============================================================
  // getRoom() — 获取房间信息
  // ============================================================
  describe("getRoom()", () => {
    it("有效房间应返回房间信息", () => {
      const { roomId } = ps.createPairingCode("device-001");
      const room = ps.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room!.code).toMatch(/^\d{6}$/);
      expect(room!.creatorDeviceId).toBe("device-001");
    });

    it("过期房间应返回 undefined", () => {
      const { roomId } = ps.createPairingCode("device-001");

      vi.advanceTimersByTime(2 * 60 * 1000 + 1000);

      const room = ps.getRoom(roomId);
      expect(room).toBeUndefined();
    });

    it("不存在的房间应返回 undefined", () => {
      const room = ps.getRoom("nonexistent");
      expect(room).toBeUndefined();
    });
  });

  // ============================================================
  // deleteRoom() & cleanup() — 房间清理
  // ============================================================
  describe("cleanup()", () => {
    it("过期房间应在定时清理中被删除", () => {
      const { roomId } = ps.createPairingCode("device-001");

      // 推进时间触发清理
      vi.advanceTimersByTime(2 * 60 * 1000 + 31_000); // TTL + cleanup interval

      const room = ps.getRoom(roomId);
      expect(room).toBeUndefined();
    });

    it("未过期房间不应被清理", () => {
      ps.createPairingCode("device-001");

      // 推进时间但未过期
      vi.advanceTimersByTime(60_000); // 1 分钟

      const room = ps.getRoom("room-1");
      expect(room).toBeDefined();
    });
  });
});
