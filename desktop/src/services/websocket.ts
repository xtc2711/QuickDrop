// ============================================================
// 桌面客户端 — WebSocket 连接管理
// 连接信令服务，处理设备发现和 WebRTC 信令
// ============================================================

import { useAuthStore } from "../stores/authStore";
import { useDeviceStore } from "../stores/deviceStore";
import { webrtcService } from "./webrtc";

// 检测是否在 iOS 模拟器中运行
function getSignalWs(): string {
  if (typeof window === "undefined") return "ws://localhost:3002";
  const hostname = window.location.hostname;
  const isIOSSimulator = /iPhone|iPad/.test(navigator.userAgent) && hostname === "localhost";
  if (isIOSSimulator) {
    return "ws://localhost:3002";
  }
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `ws://${hostname}:3002`;
  }
  return "ws://localhost:3002";
}

const SIGNAL_WS = getSignalWs();

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pendingMessages: Array<{ type: string; payload: unknown; target?: string }> = [];
  private missedPongs = 0;
  private readonly MAX_MISSED_PONGS = 3;
  private offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 配对消息回调（供 PairingDialog 注册） */
  private onPairingMessage:
    | ((msg: { type: string; payload: any }) => void)
    | null = null;

  /** 设备变更回调（配对/上线/下线时触发） */
  private onDeviceChange: (() => void) | null = null;

  /** 注册配对消息回调 */
  setPairingCallback(cb: ((msg: { type: string; payload: any }) => void) | null): void {
    this.onPairingMessage = cb;
  }

  /** 注册设备变更回调 */
  setDeviceChangeCallback(cb: (() => void) | null): void {
    this.onDeviceChange = cb;
  }

  /** 获取当前设备 ID（诊断用） */
  getOwnDeviceId(): string {
    return useAuthStore.getState().currentDevice?.id || "unknown";
  }

  /** 检查是否已连接 */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 建立 WebSocket 连接（幂等：已连接或连接中则跳过）
   */
  connect(): void {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    // 已连接或正在连接中则跳过
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log("[WS] Already connected or connecting, skipping");
      return;
    }

    const url = `${SIGNAL_WS}/?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("📶 WebSocket connected");
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.sendDeviceInfo();
      // 发送积压消息
      this.flushPending();
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
   * 发送消息（返回是否发送成功，若未连接则加入待发队列）
   */
  send(type: string, payload: unknown, target?: string): boolean {
    // 信令消息记录
    if (["offer","answer","ice_candidate"].includes(type)) {
      console.log(`[WS] 📤 send ${type} → ${(target||'?').slice(0,8)}`);
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WS] Queuing "${type}": not connected (readyState=${this.ws?.readyState ?? "null"})`);
      this.pendingMessages.push({ type, payload, target });
      return false;
    }
    this.ws.send(
      JSON.stringify({
        type,
        payload,
        target,
        timestamp: new Date().toISOString(),
      }),
    );
    return true;
  }

  /** 发送连接建立前积压的消息 */
  private flushPending(): void {
    if (this.pendingMessages.length === 0) return;
    console.log(`[WS] Flushing ${this.pendingMessages.length} pending messages`);
    const messages = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const msg of messages) {
      this.send(msg.type, msg.payload, msg.target);
    }
  }

  /**
   * 处理收到的消息
   */
  private handleMessage(message: { type: string; payload: unknown }): void {
    const deviceStore = useDeviceStore.getState();

    switch (message.type) {
      case "pong":
        this.missedPongs = 0; // 收到服务器响应，重置计数器
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
        console.log("Online devices:", online_devices);
        // 取消所有待定离线 + 同步在线设备
        const now = new Date().toISOString();
        for (const d of online_devices) {
          const timer = this.offlineTimers.get(d.device_id);
          if (timer) { clearTimeout(timer); this.offlineTimers.delete(d.device_id); }
        }
        for (const d of online_devices) {
          deviceStore.addDevice({
            id: d.device_id,
            device_name: d.device_name,
            device_type: d.device_type as "desktop" | "phone" | "tablet",
            os: d.os as "windows" | "macos" | "android" | "ios",
            is_online: true,
            first_seen: now,
            last_seen: now,
          });
        }
        break;
      }

      case "device_online": {
        const { device_id, device_name, device_type, os } = message.payload as {
          device_id: string;
          device_name: string;
          device_type: string;
          os: string;
        };
        // 取消待定的离线标记
        const timer = this.offlineTimers.get(device_id);
        if (timer) { clearTimeout(timer); this.offlineTimers.delete(device_id); }
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
        // 5 秒缓冲：传输中短暂断连不立即标记离线
        const existing = this.offlineTimers.get(device_id);
        if (existing) clearTimeout(existing);
        this.offlineTimers.set(device_id, setTimeout(() => {
          deviceStore.setDeviceOnline(device_id, false);
          this.offlineTimers.delete(device_id);
        }, 5_000));
        break;
      }

      case "force_logout":
        // 服务器强制下线
        useAuthStore.getState().logout();
        this.disconnect();
        break;

      // --- 配对消息 ---
      case "pairing_success": {
        // 配对成功：将对方设备加入已配对列表（附带真实名称）
        const p = message.payload as {
          peer_device_id: string; peer_device_name?: string;
          peer_device_type?: string; peer_os?: string;
        };
        if (p.peer_device_id) {
          deviceStore.addPairedDevice({
            id: p.peer_device_id,
            device_name: p.peer_device_name || "已配对设备",
            device_type: (p.peer_device_type || "desktop") as "desktop" | "phone" | "tablet",
            os: (p.peer_os || "macos") as any,
            is_online: true,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
          });
        }
        if (this.onDeviceChange) this.onDeviceChange();
        if (this.onPairingMessage) {
          this.onPairingMessage({ type: message.type, payload: message.payload });
        }
        break;
      }

      case "pairing_code_created":
      case "pairing_qr_created":
      case "pairing_failed":
        if (this.onPairingMessage) {
          this.onPairingMessage({ type: message.type, payload: message.payload });
        }
        break;

      case "peer_join": {
        // 对方通过配对加入，添加到已配对列表
        const pj = message.payload as {
          device_id: string; device_name: string;
          device_type: string; os: string; room_id: string;
        };
        console.log("New peer joined:", pj);
        deviceStore.addPairedDevice({
          id: pj.device_id,
          device_name: pj.device_name,
          device_type: pj.device_type as "desktop" | "phone" | "tablet",
          os: pj.os as "windows" | "macos" | "android" | "ios",
          is_online: true,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
        });
        if (this.onDeviceChange) this.onDeviceChange();
        break;
      }

      // --- WebRTC 信令透传 ---

      case "offer": {
        const from_device_id = (message as any).from_device_id || "";
        const sdp = message.payload as RTCSessionDescriptionInit;
        console.log(`[WS] 📥 offer from ${from_device_id.slice(0,8)}, sdp=${sdp?.type}`);

        webrtcService.handleOffer(from_device_id, sdp, (msg) =>
          this.send(msg.type, msg.payload, msg.target),
        ).catch((err) => {
          this.send("error", { message: `handleOffer failed: ${err?.message || String(err)}`, target: from_device_id });
        });
        break;
      }

      case "answer": {
        const from_device_id = (message as any).from_device_id || "";
        const sdp = message.payload as RTCSessionDescriptionInit;
        console.log(`[WS] 📥 answer from ${from_device_id.slice(0,8)}, sdp=${sdp?.type}`);
        webrtcService.handleAnswer(from_device_id, sdp).catch((err) => {
          console.warn(`[WS] handleAnswer error (ignored): ${err?.message}`);
        });
        break;
      }

      case "ice_candidate": {
        const from_device_id = (message as any).from_device_id || "";
        const { ...candidateInit } = message.payload as {
          candidate: string;
          sdpMid: string | null;
          sdpMLineIndex: number | null;
        };
        webrtcService.handleIceCandidate(from_device_id, candidateInit);
        break;
      }

      case "debug_report": {
        const r = message.payload as { step: string; by: string; rtcp_available?: boolean; error?: string };
        console.log(`🐛 [DEBUG from ${r.by?.slice(0,8) || '?'}] ${r.step} ${r.rtcp_available !== undefined ? 'RTCP='+r.rtcp_available : ''} ${r.error || ''}`);
        break;
      }

      case "error": {
        const errMsg = (message.payload as { message?: string })?.message || "未知错误";
        console.error("❌ Server error:", errMsg, message.payload);
        break;
      }

      default:
        console.debug("Unhandled WS message:", message.type, message.payload);
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
    this.missedPongs = 0;
    this.heartbeatTimer = setInterval(() => {
      this.missedPongs++;
      if (this.missedPongs >= this.MAX_MISSED_PONGS) {
        console.warn(`[WS] ${this.missedPongs} consecutive pongs missed, reconnecting`);
        this.missedPongs = 0;
        this.ws?.close(4000, "heartbeat timeout");
        return;
      }
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
