// ============================================================
// 信令服务 — 配对处理器
// 处理配对码创建、扫码配对、加入配对房间
// ============================================================

import type WebSocket from "ws";
import type { WsJwtPayload } from "../middleware/authMiddleware.js";
import type { WsMessage } from "../models/types.js";
import { pairingService } from "../services/pairingService.js";
import { deviceManager } from "../services/deviceManager.js";

// 简化版 IP 限速存储（配对码验证限速 5 次/60秒）
const joinRateLimiter = new Map<string, { count: number; resetAt: number }>();

/**
 * 处理配对相关消息
 */
export function handlePairingMessage(
  ws: WebSocket,
  sender: WsJwtPayload,
  message: WsMessage,
): void {
  switch (message.type) {
    case "create_pairing_code":
      handleCreatePairingCode(ws, sender);
      break;
    case "create_pairing_qr":
      handleCreatePairingQR(ws, sender);
      break;
    case "join_pairing":
      handleJoinPairing(ws, sender, message.payload);
      break;
    default:
      ws.send(
        JSON.stringify({
          type: "error",
          payload: { message: `未知的配对消息类型: ${message.type}` },
          timestamp: new Date().toISOString(),
        }),
      );
  }
}

/**
 * 创建 6 位配对码
 */
function handleCreatePairingCode(ws: WebSocket, sender: WsJwtPayload): void {
  const { code, roomId, expiresAt } = pairingService.createPairingCode(sender.device_id);

  ws.send(
    JSON.stringify({
      type: "pairing_code_created",
      payload: {
        code,
        room_id: roomId,
        expires_in: Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
      },
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * 创建扫码配对（生成二维码数据）
 */
function handleCreatePairingQR(ws: WebSocket, sender: WsJwtPayload): void {
  const { qrData, roomId, expiresAt } = pairingService.createQRPairing(sender.device_id);

  ws.send(
    JSON.stringify({
      type: "pairing_qr_created",
      payload: {
        qr_data: qrData,
        room_id: roomId,
        expires_in: Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
      },
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * 加入配对（通过配对码或 room_id）
 * payload: { code?: string, room_id?: string, device_name, device_type, os }
 */
function handleJoinPairing(ws: WebSocket, sender: WsJwtPayload, payload: unknown): void {
  const data = payload as {
    code?: string;
    room_id?: string;
    device_name?: string;
    device_type?: string;
    os?: string;
  };

  // 限速检查
  const clientKey = sender.sub; // 按用户限速（实际生产可用 IP）
  const now = Date.now();
  let rateEntry = joinRateLimiter.get(clientKey);

  if (!rateEntry || rateEntry.resetAt <= now) {
    rateEntry = { count: 0, resetAt: now + 60_000 };
    joinRateLimiter.set(clientKey, rateEntry);
  }

  rateEntry.count++;
  if (rateEntry.count > 5) {
    ws.send(
      JSON.stringify({
        type: "error",
        payload: { message: "配对尝试过于频繁，请 60 秒后重试" },
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  // 更新设备信息
  const device = deviceManager.get(sender.device_id);
  if (device && data.device_name) {
    device.deviceName = data.device_name;
    device.deviceType = (data.device_type as "desktop" | "phone" | "tablet") || device.deviceType;
    device.os = (data.os as "windows" | "macos" | "android" | "ios") || device.os;
  }

  // 执行配对逻辑
  let result: { roomId?: string; creatorDeviceId?: string; error?: string };

  if (data.room_id) {
    const joinResult = pairingService.joinByRoom(data.room_id, sender.device_id);
    if ("error" in joinResult) {
      result = { error: joinResult.error };
    } else {
      result = { roomId: data.room_id, creatorDeviceId: joinResult.creatorDeviceId };
    }
  } else if (data.code) {
    const joinResult = pairingService.joinByCode(data.code, sender.device_id);
    if ("error" in joinResult) {
      result = { error: joinResult.error };
    } else {
      result = { roomId: joinResult.roomId, creatorDeviceId: joinResult.creatorDeviceId };
    }
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        payload: { message: "请提供配对码 (code) 或房间 ID (room_id)" },
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  if (result.error) {
    ws.send(
      JSON.stringify({
        type: "error",
        payload: { message: result.error },
        timestamp: new Date().toISOString(),
      }),
    );
    return;
  }

  // 配对成功，通知双方
  ws.send(
    JSON.stringify({
      type: "pairing_success",
      payload: {
        peer_device_id: result.creatorDeviceId,
      },
      timestamp: new Date().toISOString(),
    }),
  );

  // 通知创建方有新设备加入
  deviceManager.sendToDevice(result.creatorDeviceId!, {
    type: "peer_join",
    payload: {
      device_id: sender.device_id,
      device_name: device?.deviceName || "unknown",
      device_type: device?.deviceType || "desktop",
      os: device?.os || "macos",
      room_id: result.roomId,
    },
    timestamp: new Date().toISOString(),
  });
}
