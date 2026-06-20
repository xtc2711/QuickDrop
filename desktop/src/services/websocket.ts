// ============================================================
// 桌面客户端 — WebSocket 连接管理
// 连接信令服务，处理设备发现和 WebRTC 信令
// ============================================================

import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { webrtcService } from "./webrtc";

const SIGNAL_WS = "ws://localhost:3002";

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    const url = `${SIGNAL_WS}/?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("📶 WebSocket connected");
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.sendDeviceInfo();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch {
        console.warn("Failed to parse WebSocket message");
      }
    };

    this.ws.onclose = (event) => {
      console.log(`📴 WebSocket closed: ${event.code}`);
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }

  /**
   * 断开 WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close(1000, "user_logout");
    this.ws = null;
  }

  /**
   * 发送消息
   */
  send(type: string, payload: unknown, target?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type,
        payload,
        target,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: { type: string; payload: unknown }): void {
    const deviceStore = useDeviceStore.getState();

    switch (message.type) {
      case "pong":
        // 心跳响应，无需处理
        break;

      case "device_list_update": {
        const { online_devices } = message.payload as {
          online_devices: Array<{
            device_id: string;
            device_name: string;
            device_type: string;
            os: string;
          }>;
        };
        // 更新在线设备列表
        console.log("Online devices:", online_devices);
        break;
      }

      case "device_online": {
        const { device_id, device_name, device_type, os } = message.payload as {
          device_id: string;
          device_name: string;
          device_type: string;
          os: string;
        };
        deviceStore.addDevice({
          id: device_id,
          device_name,
          device_type: device_type as "desktop" | "phone" | "tablet",
          os: os as "windows" | "macos" | "android" | "ios",
          is_online: true,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        });
        break;
      }

      case "device_offline": {
        const { device_id } = message.payload as { device_id: string };
        deviceStore.setDeviceOnline(device_id, false);
        break;
      }

      case "force_logout":
        // 服务器强制下线
        useAuthStore.getState().logout();
        this.disconnect();
        break;

      // --- WebRTC 信令透传 ---

      case "offer": {
        const { from_device_id, sdp } = message.payload as {
          from_device_id: string;
          sdp: RTCSessionDescriptionInit;
        };
        webrtcService.handleOffer(from_device_id, sdp, (msg) =>
          this.send(msg.type, msg.payload, msg.target),
        );
        break;
      }

      case "answer": {
        const { from_device_id, sdp } = message.payload as {
          from_device_id: string;
          sdp: RTCSessionDescriptionInit;
        };
        webrtcService.handleAnswer(from_device_id, sdp);
        break;
      }

      case "ice_candidate": {
        const { from_device_id, ...candidateInit } = message.payload as {
          from_device_id: string;
          candidate: string;
          sdpMid: string | null;
          sdpMLineIndex: number | null;
        };
        webrtcService.handleIceCandidate(from_device_id, candidateInit);
        break;
      }

      default:
        // 其他消息（信令等）由对应的 handler 处理
        console.debug("Unhandled WS message:", message.type);
    }
  }

  /**
   * 发送设备信息
   */
  private sendDeviceInfo(): void {
    const device = useAuthStore.getState().currentDevice;
    if (device) {
      this.send("device_info", {
        device_name: device.device_name,
        device_type: device.device_type,
        os: device.os,
      });
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send("ping", {});
    }, 15_000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 自动重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`🔄 Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect();
    }, delay);
  }
}

// 单例导出
export const wsService = new WebSocketService();
