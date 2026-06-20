// ============================================================
// 信令服务 — 内部类型定义
// ============================================================

import type WebSocket from "ws";

/**
 * 已连接设备的状态信息
 */
export interface DeviceState {
  ws: WebSocket;
  userId: string;
  deviceId: string;
  deviceName: string;
  deviceType: "desktop" | "phone" | "tablet";
  os: "windows" | "macos" | "android" | "ios";
  connectedAt: Date;
  lastHeartbeat: Date;
  isAlive: boolean;
  roomId?: string; // 配对房间 ID（如参与了配对）
}

/**
 * 配对房间
 */
export interface PairingRoom {
  roomId: string;
  code?: string; // 6 位配对码（如有）
  creatorDeviceId: string;
  createdAt: Date;
  expiresAt: Date;
  joinedDeviceId?: string;
  used: boolean;
}

/**
 * WebSocket 消息结构
 */
export interface WsMessage {
  type: string;
  payload: unknown;
  timestamp: string;
  room_id?: string;
  target?: string;
}
