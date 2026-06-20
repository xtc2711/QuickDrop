// ============================================================
// 信令服务 — WebSocket 连接处理器
// 处理设备上下线、心跳、消息路由
// ============================================================

import type WebSocket from "ws";
import type { WsJwtPayload } from "../middleware/authMiddleware.js";
import type { WsMessage } from "../models/types.js";
import { deviceManager } from "../services/deviceManager.js";
import { handleSignalingMessage } from "./signalingHandler.js";
import { handlePairingMessage } from "./pairingHandler.js";

/**
 * 处理新 WebSocket 连接
 * 注册设备 → 监听消息 → 处理断开
 */
export function handleConnection(ws: WebSocket, payload: WsJwtPayload): void {
  // 注册设备
  deviceManager.register({
    ws,
    userId: payload.sub,
    deviceId: payload.device_id,
    deviceName: "unknown", // 将由客户端在首次消息中上报
    deviceType: "desktop",
    os: "macos",
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
    isAlive: true,
  });

  // 监听消息
  ws.on("message", (data) => {
    try {
      const message: WsMessage = JSON.parse(data.toString());

      // 路由消息到对应处理器
      switch (message.type) {
        case "ping":
          deviceManager.heartbeat(payload.device_id);
          ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
          break;

        case "device_info":
          handleDeviceInfo(payload.device_id, message.payload);
          break;

        case "create_pairing_code":
        case "create_pairing_qr":
        case "join_pairing":
          handlePairingMessage(ws, payload, message);
          break;

        case "offer":
        case "answer":
        case "ice_candidate":
          handleSignalingMessage(ws, payload, message);
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error("Failed to parse message:", err);
      ws.send(
        JSON.stringify({
          type: "error",
          payload: { message: "消息格式错误" },
          timestamp: new Date().toISOString(),
        }),
      );
    }
  });

  // 监听断开
  ws.on("close", () => {
    console.log(`📴 Device ${payload.device_id} disconnected`);
    deviceManager.unregister(payload.device_id);
  });

  // 监听错误
  ws.on("error", (err) => {
    console.error(`WebSocket error on device ${payload.device_id}:`, err.message);
  });
}

/**
 * 处理设备信息上报
 */
function handleDeviceInfo(deviceId: string, payload: unknown): void {
  const info = payload as {
    device_name?: string;
    device_type?: string;
    os?: string;
  };

  if (info) {
    const device = deviceManager.get(deviceId);
    if (device) {
      if (info.device_name) device.deviceName = info.device_name;
      if (info.device_type) device.deviceType = info.device_type as "desktop" | "phone" | "tablet";
      if (info.os) device.os = info.os as "windows" | "macos" | "android" | "ios";
    }
  }
}
