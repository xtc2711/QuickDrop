// ============================================================
// 信令服务 — WebRTC 信令透传处理器
// 负责转发 offer/answer/ICE candidate 到目标设备
// ============================================================

import type WebSocket from "ws";
import type { WsJwtPayload } from "../middleware/authMiddleware.js";
import type { WsMessage } from "../models/types.js";
import { deviceManager } from "../services/deviceManager.js";

/**
 * 处理 WebRTC 信令消息（透传）
 * 消息格式:
 * {
 *   type: "offer" | "answer" | "ice_candidate",
 *   payload: { sdp, candidate, ... },
 *   target: "<target_device_id>"
 * }
 */
export function handleSignalingMessage(
  ws: WebSocket,
  sender: WsJwtPayload,
  message: WsMessage,
): void {
  const { type, payload, target } = message;
  const ts = new Date().toISOString();

  console.log(`[signal] ${type} from ${sender.device_id.slice(0,8)} → ${(target||'?').slice(0,8)}`);

  if (!target) {
    console.warn(`[signal] ${type} missing target`);
    ws.send(JSON.stringify({
      type: "error",
      payload: { message: "缺少 target 字段，无法路由信令消息" },
      timestamp: ts,
    }));
    return;
  }

  // 透传给目标设备（保持 payload 原样，不展开 SDP）
  const sent = deviceManager.sendToDevice(target, {
    type,
    payload: payload,
    from_device_id: sender.device_id,
    timestamp: ts,
  });

  if (!sent) {
    console.warn(`[signal] ${type} FAILED: target ${target.slice(0,8)} not online`);
    ws.send(JSON.stringify({
      type: "error",
      payload: { message: "目标设备不在线", target_device_id: target },
      timestamp: ts,
    }));
  } else {
    console.log(`[signal] ${type} forwarded to ${target.slice(0,8)}`);
  }
}
