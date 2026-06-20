// ============================================================
// 信令服务 — 配对服务
// 配对码生成、配对房间管理、扫码配对
// ============================================================

import { v4 as uuidv4 } from "uuid";
import { generatePairingCode, PAIRING_CODE_TTL_MS } from "../../../../shared/utils/index.js";
import type { PairingRoom } from "../models/types.js";

class PairingService {
  /** roomId → PairingRoom */
  private rooms = new Map<string, PairingRoom>();
  /** code → roomId */
  private codeIndex = new Map<string, string>();

  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    // 每 30 秒清理过期房间
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
  }

  /**
   * 创建配对码房间
   */
  createPairingCode(creatorDeviceId: string): { code: string; roomId: string; expiresAt: Date } {
    const code = generatePairingCode();
    const roomId = uuidv4();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    const room: PairingRoom = {
      roomId,
      code,
      creatorDeviceId,
      createdAt: new Date(),
      expiresAt,
      used: false,
    };

    this.rooms.set(roomId, room);
    this.codeIndex.set(code, roomId);

    return { code, roomId, expiresAt };
  }

  /**
   * 创建扫码配对房间
   */
  createQRPairing(creatorDeviceId: string): { qrData: string; roomId: string; expiresAt: Date } {
    const roomId = uuidv4();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    const room: PairingRoom = {
      roomId,
      creatorDeviceId,
      createdAt: new Date(),
      expiresAt,
      used: false,
    };

    this.rooms.set(roomId, room);

    // 二维码内容：包含 room_id 的 JSON 字符串
    const qrData = JSON.stringify({
      type: "quickdrop_pairing",
      room_id: roomId,
      expires_at: expiresAt.toISOString(),
    });

    return { qrData, roomId, expiresAt };
  }

  /**
   * 通过配对码加入房间
   */
  joinByCode(
    code: string,
    joinerDeviceId: string,
  ): { roomId: string; creatorDeviceId: string } | { error: string } {
    // 限速逻辑已移至 handler 层（基于 IP）

    const roomId = this.codeIndex.get(code);
    if (!roomId) {
      return { error: "配对码无效" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { error: "房间不存在" };
    }

    if (new Date() > room.expiresAt) {
      this.deleteRoom(roomId);
      return { error: "配对码已过期" };
    }

    if (room.used) {
      return { error: "配对码已被使用" };
    }

    // 防止自己配对自己
    if (room.creatorDeviceId === joinerDeviceId) {
      return { error: "不能与自己的设备配对" };
    }

    room.joinedDeviceId = joinerDeviceId;
    room.used = true;

    return { roomId, creatorDeviceId: room.creatorDeviceId };
  }

  /**
   * 通过 roomId 加入房间（扫码配对）
   */
  joinByRoom(
    roomId: string,
    joinerDeviceId: string,
  ): { creatorDeviceId: string } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { error: "配对房间不存在" };
    }

    if (new Date() > room.expiresAt) {
      this.deleteRoom(roomId);
      return { error: "配对二维码已过期" };
    }

    if (room.used) {
      return { error: "该配对链接已被使用" };
    }

    if (room.creatorDeviceId === joinerDeviceId) {
      return { error: "不能与自己的设备配对" };
    }

    room.joinedDeviceId = joinerDeviceId;
    room.used = true;

    return { creatorDeviceId: room.creatorDeviceId };
  }

  /**
   * 获取房间信息
   */
  getRoom(roomId: string): PairingRoom | undefined {
    const room = this.rooms.get(roomId);
    if (room && new Date() > room.expiresAt) {
      this.deleteRoom(roomId);
      return undefined;
    }
    return room;
  }

  /**
   * 删除房间
   */
  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room?.code) {
      this.codeIndex.delete(room.code);
    }
    this.rooms.delete(roomId);
  }

  /**
   * 清理过期房间
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      if (now > room.expiresAt.getTime()) {
        this.deleteRoom(roomId);
      }
    }
  }
}

// 导出类和单例（类导出供测试使用）
export { PairingService };
export const pairingService = new PairingService();
