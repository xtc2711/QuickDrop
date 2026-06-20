# WebRTC DataChannel 建立与管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面客户端实现 WebRTC DataChannel 的建立与管理，支持通过信令服务与目标设备建立 P2P 连接。

**Architecture:** 新建 `WebRTCService` 单例类，管理 `deviceId → RTCPeerConnection` 映射。通过现有 WebSocket 信令通道交换 SDP 和 ICE 候选。连接发起方（offer 侧）创建 DataChannel，接收方（answer 侧）通过 `ondatachannel` 事件接收。使用 Google 公共 STUN 服务器作为 ICE 配置。

**Tech Stack:** TypeScript, WebRTC API (RTCPeerConnection / RTCDataChannel), 现有 WebSocket 信令服务, React + Zustand

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `desktop/src/services/webrtc.ts` (新建) | WebRTC 对等连接管理：创建连接、信令交换、DataChannel 生命周期、连接状态跟踪 |
| `desktop/src/services/websocket.ts` (修改) | 新增 `offer`/`answer`/`ice_candidate` 消息路由到 webrtc 服务 |
| `desktop/src/pages/TransferPage.tsx` (修改) | 传输启动时触发 WebRTC 连接建立，显示连接状态 |

---

### Task 1: 创建 WebRTC 服务核心

**Files:**
- Create: `desktop/src/services/webrtc.ts`

- [ ] **Step 1: 编写 WebRTCService 类骨架**

```typescript
// ============================================================
// 桌面客户端 — WebRTC 对等连接管理
// 管理 RTCPeerConnection 和 DataChannel 生命周期
// 通过 WebSocket 信令交换 SDP / ICE 候选
// ============================================================

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const DC_LABEL = "quickdrop-file-transfer";

export type ConnectionState = "new" | "connecting" | "connected" | "disconnected" | "failed";

export interface PeerState {
  deviceId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  state: ConnectionState;
}

type ConnectionCallback = (deviceId: string, state: ConnectionState) => void;
type DataChannelCallback = (deviceId: string, dc: RTCDataChannel) => void;

class WebRTCService {
  /** deviceId → PeerState */
  private peers = new Map<string, PeerState>();

  /** 回调：连接状态变更 */
  private onConnectionChange: ConnectionCallback | null = null;
  /** 回调：DataChannel 就绪 */
  private onDataChannelReady: DataChannelCallback | null = null;

  /**
   * 注册回调
   */
  setConnectionChangeHandler(fn: ConnectionCallback): void {
    this.onConnectionChange = fn;
  }

  setDataChannelReadyHandler(fn: DataChannelCallback): void {
    this.onDataChannelReady = fn;
  }

  /**
   * 获取指定设备的对等连接状态
   */
  getPeerState(deviceId: string): PeerState | undefined {
    return this.peers.get(deviceId);
  }

  /**
   * 断开与指定设备的连接
   */
  disconnect(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.dc?.close();
      peer.pc.close();
      this.peers.delete(deviceId);
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const [deviceId] of this.peers) {
      this.disconnect(deviceId);
    }
  }

  private updateState(deviceId: string, state: ConnectionState): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.state = state;
    }
    this.onConnectionChange?.(deviceId, state);
  }
}

// 后续步骤将向此类添加方法
export const webrtcService = new WebRTCService();
```

- [ ] **Step 2: 运行 TypeScript 编译检查骨架无语法错误**

Run: `cd desktop && npx tsc --noEmit src/services/webrtc.ts 2>&1`
Expected: 无错误（或仅有模块解析警告，可忽略）

---

### Task 2: 实现发起连接（Offer 侧）

**Files:**
- Modify: `desktop/src/services/webrtc.ts` — 添加 `createOffer` 方法

- [ ] **Step 1: 添加 createOffer 方法和辅助函数**

在 `WebRTCService` 类中添加以下方法（插入到 `disconnectAll()` 之后、`private updateState` 之前）：

```typescript
  /**
   * 作为发起方创建对等连接并生成 DataChannel
   * @param deviceId 目标设备 ID
   * @param sendSignaling 发送信令消息的回调（通过 WebSocket）
   */
  async createOffer(
    deviceId: string,
    sendSignaling: (msg: { type: string; payload: unknown; target: string }) => void,
  ): Promise<void> {
    // 如果已有连接，先断开
    this.disconnect(deviceId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const dc = pc.createDataChannel(DC_LABEL, {
      ordered: true, // SCTP 可靠有序传输
    });

    const peer: PeerState = {
      deviceId,
      pc,
      dc,
      state: "connecting",
    };
    this.peers.set(deviceId, peer);
    this.updateState(deviceId, "connecting");

    // 设置 DataChannel 事件
    this.setupDataChannel(deviceId, dc);

    // 收集 ICE 候选 → 发送到目标设备
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling({
          type: "ice_candidate",
          payload: event.candidate,
          target: deviceId,
        });
      }
    };

    // 连接状态变更
    pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange(deviceId, pc);
    };

    // 创建并发送 Offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendSignaling({
      type: "offer",
      payload: pc.localDescription,
      target: deviceId,
    });
  }

  /**
   * 设置 DataChannel 事件监听
   */
  private setupDataChannel(deviceId: string, dc: RTCDataChannel): void {
    dc.onopen = () => {
      console.log(`📡 DataChannel to ${deviceId} opened`);
      this.updateState(deviceId, "connected");
      this.onDataChannelReady?.(deviceId, dc);
    };

    dc.onclose = () => {
      console.log(`📡 DataChannel to ${deviceId} closed`);
    };

    dc.onerror = (err) => {
      console.error(`DataChannel to ${deviceId} error:`, err);
    };
  }

  /**
   * 处理 RTCPeerConnection 状态变更
   */
  private handleConnectionStateChange(deviceId: string, pc: RTCPeerConnection): void {
    switch (pc.connectionState) {
      case "connected":
        this.updateState(deviceId, "connected");
        break;
      case "disconnected":
        this.updateState(deviceId, "disconnected");
        break;
      case "failed":
        this.updateState(deviceId, "failed");
        this.disconnect(deviceId);
        break;
      case "closed":
        this.updateState(deviceId, "disconnected");
        break;
    }
  }
```

---

### Task 3: 实现接受连接（Answer 侧）

**Files:**
- Modify: `desktop/src/services/webrtc.ts` — 添加 `handleOffer` 方法

- [ ] **Step 1: 添加 handleOffer 和 handleAnswer 方法**

在 `createOffer` 方法之后添加：

```typescript
  /**
   * 处理收到的 Offer，创建 Answer
   */
  async handleOffer(
    fromDeviceId: string,
    sdp: RTCSessionDescriptionInit,
    sendSignaling: (msg: { type: string; payload: unknown; target: string }) => void,
  ): Promise<void> {
    this.disconnect(fromDeviceId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    // 等待发起方的 DataChannel
    pc.ondatachannel = (event) => {
      this.setupDataChannel(fromDeviceId, event.channel);
      const peer = this.peers.get(fromDeviceId);
      if (peer) {
        peer.dc = event.channel;
      }
    };

    const peer: PeerState = {
      deviceId: fromDeviceId,
      pc,
      dc: null,
      state: "connecting",
    };
    this.peers.set(fromDeviceId, peer);
    this.updateState(fromDeviceId, "connecting");

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling({
          type: "ice_candidate",
          payload: event.candidate,
          target: fromDeviceId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange(fromDeviceId, pc);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendSignaling({
      type: "answer",
      payload: pc.localDescription,
      target: fromDeviceId,
    });
  }

  /**
   * 处理收到的 Answer，设置为远端描述
   */
  async handleAnswer(
    fromDeviceId: string,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const peer = this.peers.get(fromDeviceId);
    if (!peer) {
      console.warn(`Received answer from unknown device: ${fromDeviceId}`);
      return;
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  /**
   * 处理收到的 ICE 候选
   */
  async handleIceCandidate(
    fromDeviceId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const peer = this.peers.get(fromDeviceId);
    if (!peer) {
      console.warn(`Received ICE candidate from unknown device: ${fromDeviceId}`);
      return;
    }
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error(`Failed to add ICE candidate from ${fromDeviceId}:`, err);
    }
  }
```

---

### Task 4: 集成 WebSocket — 路由信令消息

**Files:**
- Modify: `desktop/src/services/websocket.ts` — 在 `handleMessage` 中路由信令消息

- [ ] **Step 1: 在 websocket.ts 中导入 webrtc 服务并路由信令消息**

在 `desktop/src/services/websocket.ts` 顶部添加导入（第 6 行后插入）：

```typescript
import { webrtcService } from "./webrtc";
```

- [ ] **Step 2: 在 handleMessage 的 switch 中添加信令消息处理**

在 `handleMessage` 方法的 switch 语句中，在 `case "device_offline":` 块之后、`case "force_logout":` 之前添加：

```typescript
      // --- WebRTC 信令透传 ---
      case "offer": {
        const { from_device_id, sdp } = message.payload as {
          from_device_id: string;
          sdp: RTCSessionDescriptionInit;
        };
        webrtcService.handleOffer(from_device_id, sdp, (msg) => this.send(msg.type, msg.payload, msg.target));
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
```

---

### Task 5: 更新 TransferPage — 传输前建立连接

**Files:**
- Modify: `desktop/src/pages/TransferPage.tsx` — 在 `startTransfer` 中建立 WebRTC 连接

- [ ] **Step 1: 导入 webrtc 服务并在 startTransfer 中建立连接**

在 `TransferPage.tsx` 顶部第 8 行后添加导入：

```typescript
import { webrtcService } from "../services/webrtc";
import { wsService } from "../services/websocket";
```

- [ ] **Step 2: 修改 startTransfer 函数**

将 `startTransfer` 函数（第 74-79 行）替换为：

```typescript
  const [connectingDevice, setConnectingDevice] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const startTransfer = async () => {
    if (!deviceId) return;

    setTransferring(true);
    setConnectionError(null);
    setConnectingDevice(deviceId);

    // 注册连接成功回调
    webrtcService.setDataChannelReadyHandler((devId, dc) => {
      console.log(`✅ DataChannel ready for device ${devId}`);
      setConnectingDevice(null);
      // TODO: 第 4 周后续任务 — 通过 dc 发送文件数据
    });

    webrtcService.setConnectionChangeHandler((devId, state) => {
      if (state === "failed") {
        setConnectionError(`连接设备失败，请重试`);
        setTransferring(false);
        setConnectingDevice(null);
      }
      if (state === "connected") {
        setConnectingDevice(null);
      }
    });

    // 发起 WebRTC 连接（Offer 侧）
    webrtcService.createOffer(deviceId, (msg) => {
      wsService.send(msg.type, msg.payload, msg.target);
    });
  };
```

- [ ] **Step 3: 在 UI 中显示连接状态**

在 "开始传输" 按钮上方（第 218 行 `<button>` 之前）添加连接状态提示：

```typescript
          {connectingDevice && (
            <div style={{
              textAlign: "center",
              padding: 8,
              fontSize: 13,
              color: "var(--color-primary)",
            }}>
              🔗 正在建立 P2P 连接...
            </div>
          )}
          {connectionError && (
            <div style={{
              textAlign: "center",
              padding: 8,
              fontSize: 13,
              color: "var(--color-danger)",
            }}>
              ❌ {connectionError}
            </div>
          )}
```

---

### Task 6: 编译验证与提交

- [ ] **Step 1: TypeScript 编译检查**

Run: `cd desktop && npx tsc --noEmit 2>&1`
Expected: 无类型错误

- [ ] **Step 2: 提交**

```bash
git add desktop/src/services/webrtc.ts desktop/src/services/websocket.ts desktop/src/pages/TransferPage.tsx docs/superpowers/plans/2026-06-21-webrtc-datachannel.md
git commit -m "feat(desktop): 实现 WebRTC DataChannel 建立与管理

- 新建 WebRTCService 单例类，管理 RTCPeerConnection/DataChannel 生命周期
- 支持 Offer/Answer 模式建立 P2P 连接
- 通过 WebSocket 信令交换 SDP 和 ICE 候选
- ICE 服务器使用 Google 公共 STUN
- DataChannel 使用有序可靠模式（SCTP）
- TransferPage 传输前自动建立 WebRTC 连接"
```
