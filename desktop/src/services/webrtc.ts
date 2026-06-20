// ============================================================
// 桌面客户端 — WebRTC 对等连接管理
// 管理 RTCPeerConnection 和 DataChannel 生命周期
// 通过 WebSocket 信令交换 SDP / ICE 候选
// 自动检测连接通道类型（局域网 P2P / TURN 中继）
//
// 连接控制：
//   - ICE 连接超时 30 秒（spec §5.5）
//   - 最多 3 个并发连接尝试，超出排队
//   - 连接失败后指数退避重试（最多 3 次）
//   - 支持自建 STUN/TURN 服务器配置
// ============================================================

import type { ConnectionChannel } from "../../../shared/types/index";

// ---- 可配置 ICE 服务器列表 ----
// 生产环境应替换为自建 STUN/TURN 服务器地址
const DEFAULT_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // 自建服务器示例（部署后取消注释）：
    // { urls: "stun:stun.quickdrop.app:3478" },
    // {
    //   urls: "turn:turn.quickdrop.app:3478?transport=udp",
    //   username: "quickdrop",
    //   credential: "<your-secret>",
    // },
    // {
    //   urls: "turn:turn.quickdrop.app:3478?transport=tcp",
    //   username: "quickdrop",
    //   credential: "<your-secret>",
    // },
  ],
};

// ---- 连接控制参数 ----

/** ICE 连接超时时间（毫秒），spec §5.5 */
const CONNECTION_TIMEOUT_MS = 30_000;

/** 最大并发连接尝试数 */
const MAX_CONCURRENT_CONNECTIONS = 3;

/** 最大重试次数 */
const MAX_RETRY_COUNT = 3;

/** 重试基础延迟（毫秒），指数退避：delay * 2^retry */
const RETRY_BASE_DELAY_MS = 1_000;

const DC_LABEL = "quickdrop-file-transfer";

// ---- 类型定义 ----

export type ConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

export interface PeerState {
  deviceId: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  state: ConnectionState;
  /** 检测到的连接通道类型 */
  connectionChannel: ConnectionChannel;
}

type ConnectionCallback = (deviceId: string, state: ConnectionState) => void;
type DataChannelCallback = (deviceId: string, dc: RTCDataChannel) => void;
type ChannelCallback = (deviceId: string, channel: ConnectionChannel) => void;

/** 发送信令消息的回调签名 */
export type SignalingSender = (msg: {
  type: string;
  payload: unknown;
  target: string;
}) => void;

/** 待处理的连接请求（用于排队控制） */
interface PendingConnection {
  deviceId: string;
  isOffer: boolean;
  sdp?: RTCSessionDescriptionInit;
  sendSignaling: SignalingSender;
  retryCount: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

// ---- WebRTCService ----

class WebRTCService {
  /** deviceId → PeerState */
  private peers = new Map<string, PeerState>();

  /** deviceId → 检测到的 ICE 候选类型集合 */
  private iceCandidateTypes = new Map<string, Set<string>>();

  /** 当前正在进行的连接尝试数 */
  private activeConnectionAttempts = 0;

  /** 连接请求等待队列 */
  private connectionQueue: PendingConnection[] = [];

  /** 连接超时定时器 deviceId → timeoutId */
  private connectionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  /** 回调：连接状态变更 */
  private onConnectionChange: ConnectionCallback | null = null;
  /** 回调：DataChannel 就绪 */
  private onDataChannelReady: DataChannelCallback | null = null;
  /** 回调：连接通道变更 */
  private onChannelChange: ChannelCallback | null = null;

  // ============================================================
  // 公共 API — 配置
  // ============================================================

  /**
   * 获取当前使用的 ICE 服务器配置
   */
  getIceConfig(): RTCConfiguration {
    return DEFAULT_ICE_SERVERS;
  }

  /**
   * 注册连接状态变更回调
   */
  setConnectionChangeHandler(fn: ConnectionCallback): void {
    this.onConnectionChange = fn;
  }

  /**
   * 注册 DataChannel 就绪回调
   */
  setDataChannelReadyHandler(fn: DataChannelCallback): void {
    this.onDataChannelReady = fn;
  }

  /**
   * 注册连接通道变更回调
   */
  setChannelChangeHandler(fn: ChannelCallback): void {
    this.onChannelChange = fn;
  }

  // ============================================================
  // 公共 API — 查询
  // ============================================================

  /**
   * 获取指定设备的连接通道类型
   */
  getConnectionChannel(deviceId: string): ConnectionChannel | undefined {
    return this.peers.get(deviceId)?.connectionChannel;
  }

  /**
   * 获取指定设备的对等连接状态
   */
  getPeerState(deviceId: string): PeerState | undefined {
    return this.peers.get(deviceId);
  }

  /**
   * 检查是否有活跃连接
   */
  isConnected(deviceId: string): boolean {
    return this.peers.get(deviceId)?.state === "connected";
  }

  /**
   * 获取所有已连接设备的 DataChannel
   */
  getConnectedChannels(): Array<{ deviceId: string; dc: RTCDataChannel }> {
    const result: Array<{ deviceId: string; dc: RTCDataChannel }> = [];
    for (const [deviceId, peer] of this.peers) {
      if (peer.state === "connected" && peer.dc?.readyState === "open") {
        result.push({ deviceId, dc: peer.dc });
      }
    }
    return result;
  }

  /**
   * 获取当前活跃连接尝试数（用于 UI 显示）
   */
  getActiveAttemptCount(): number {
    return this.activeConnectionAttempts;
  }

  /**
   * 获取等待队列长度（用于 UI 显示）
   */
  getQueueLength(): number {
    return this.connectionQueue.length;
  }

  // ============================================================
  // 公共 API — 断开连接
  // ============================================================

  /**
   * 断开与指定设备的连接
   */
  disconnect(deviceId: string): void {
    // 清理超时定时器
    const timeoutId = this.connectionTimeouts.get(deviceId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.connectionTimeouts.delete(deviceId);
    }

    // 从队列中移除待处理的连接请求
    const queueIndex = this.connectionQueue.findIndex(
      (q) => q.deviceId === deviceId,
    );
    if (queueIndex >= 0) {
      const [removed] = this.connectionQueue.splice(queueIndex, 1);
      clearTimeout(removed.timeoutId);
      this.processQueue();
    }

    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.dc?.close();
      peer.pc.close();
      this.peers.delete(deviceId);
      this.iceCandidateTypes.delete(deviceId);
      this.connectionTimeouts.delete(deviceId);
      this.updateState(deviceId, "disconnected");
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    // 清理所有超时
    for (const [, timeoutId] of this.connectionTimeouts) {
      clearTimeout(timeoutId);
    }
    this.connectionTimeouts.clear();

    // 清理队列
    for (const pending of this.connectionQueue) {
      clearTimeout(pending.timeoutId);
    }
    this.connectionQueue = [];
    this.activeConnectionAttempts = 0;

    // 断开所有对等连接
    for (const [deviceId] of this.peers) {
      const peer = this.peers.get(deviceId);
      if (peer) {
        peer.dc?.close();
        peer.pc.close();
      }
    }
    this.peers.clear();
    this.iceCandidateTypes.clear();
  }

  // ============================================================
  // Offer 侧（发起方）
  // ============================================================

  /**
   * 作为发起方创建对等连接并生成 DataChannel
   *
   * 受并发连接数限制：如果当前已有 MAX_CONCURRENT_CONNECTIONS 个连接
   * 正在建立，此请求将进入等待队列。
   *
   * @param deviceId 目标设备 ID
   * @param sendSignaling 发送信令消息的回调（通过 WebSocket）
   */
  async createOffer(
    deviceId: string,
    sendSignaling: SignalingSender,
  ): Promise<void> {
    // 如果已有连接，先断开
    this.disconnect(deviceId);

    // 检查并发限制
    if (this.activeConnectionAttempts >= MAX_CONCURRENT_CONNECTIONS) {
      await this.enqueueConnection(deviceId, true, undefined, sendSignaling, 0);
    }

    this.activeConnectionAttempts++;
    await this.doCreateOffer(deviceId, sendSignaling, 0);
  }

  // ============================================================
  // Answer 侧（接收方）
  // ============================================================

  /**
   * 处理收到的 Offer，创建 Answer
   */
  async handleOffer(
    fromDeviceId: string,
    sdp: RTCSessionDescriptionInit,
    sendSignaling: SignalingSender,
  ): Promise<void> {
    this.disconnect(fromDeviceId);

    // 检查并发限制
    if (this.activeConnectionAttempts >= MAX_CONCURRENT_CONNECTIONS) {
      await this.enqueueConnection(
        fromDeviceId,
        false,
        sdp,
        sendSignaling,
        0,
      );
    }

    this.activeConnectionAttempts++;
    await this.doHandleOffer(fromDeviceId, sdp, sendSignaling, 0);
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
    candidateInit: RTCIceCandidateInit,
  ): Promise<void> {
    const peer = this.peers.get(fromDeviceId);
    if (!peer) {
      console.warn(
        `Received ICE candidate from unknown device: ${fromDeviceId}`,
      );
      return;
    }
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err) {
      console.error(
        `Failed to add ICE candidate from ${fromDeviceId}:`,
        err,
      );
    }
  }

  // ============================================================
  // 内部 — 队列管理
  // ============================================================

  /**
   * 将连接请求加入等待队列
   */
  private enqueueConnection(
    deviceId: string,
    isOffer: boolean,
    sdp: RTCSessionDescriptionInit | undefined,
    sendSignaling: SignalingSender,
    retryCount: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.connectionQueue.push({
        deviceId,
        isOffer,
        sdp,
        sendSignaling,
        retryCount,
        resolve,
      });
      console.log(
        `⏳ Connection to ${deviceId} queued (${this.connectionQueue.length} waiting)`,
      );
    });
  }

  /**
   * 处理等待队列中的下一个连接请求
   */
  private processQueue(): void {
    if (
      this.connectionQueue.length > 0 &&
      this.activeConnectionAttempts < MAX_CONCURRENT_CONNECTIONS
    ) {
      const next = this.connectionQueue.shift()!;
      next.resolve();
      console.log(
        `▶️  Dequeued connection to ${next.deviceId} (${this.connectionQueue.length} remaining)`,
      );
    }
  }

  // ============================================================
  // 内部 — Offer 实现
  // ============================================================

  private async doCreateOffer(
    deviceId: string,
    sendSignaling: SignalingSender,
    retryCount: number,
  ): Promise<void> {
    const pc = new RTCPeerConnection(DEFAULT_ICE_SERVERS);
    const dc = pc.createDataChannel(DC_LABEL, {
      ordered: true,
    });

    const peer: PeerState = {
      deviceId,
      pc,
      dc,
      state: "connecting",
      connectionChannel: "lan_p2p",
    };
    this.peers.set(deviceId, peer);
    this.iceCandidateTypes.delete(deviceId);
    this.updateState(deviceId, "connecting");

    // 启动连接超时计时器
    this.startConnectionTimeout(deviceId, () =>
      this.handleConnectionTimeout(deviceId, true, sendSignaling, retryCount),
    );

    // 设置 DataChannel 事件
    this.setupDataChannel(deviceId, dc);

    // 收集 ICE 候选 → 发送到目标设备，同时追踪候选类型
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.trackIceCandidateType(deviceId, event.candidate);
        sendSignaling({
          type: "ice_candidate",
          payload: event.candidate.toJSON(),
          target: deviceId,
        });
      }
    };

    // ICE 收集状态变更
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        console.log(`🧊 ICE gathering complete for ${deviceId}`);
      }
    };

    // 连接状态变更
    pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange(
        deviceId,
        pc,
        true,
        sendSignaling,
        retryCount,
      );
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignaling({
        type: "offer",
        payload: pc.localDescription,
        target: deviceId,
      });
    } catch (err) {
      console.error(`Failed to create offer for ${deviceId}:`, err);
      this.handleConnectionFailure(
        deviceId,
        true,
        sendSignaling,
        retryCount,
        err instanceof Error ? err.message : "创建 Offer 失败",
      );
    }
  }

  // ============================================================
  // 内部 — Answer 实现
  // ============================================================

  private async doHandleOffer(
    fromDeviceId: string,
    sdp: RTCSessionDescriptionInit,
    sendSignaling: SignalingSender,
    retryCount: number,
  ): Promise<void> {
    const pc = new RTCPeerConnection(DEFAULT_ICE_SERVERS);

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
      connectionChannel: "lan_p2p",
    };
    this.peers.set(fromDeviceId, peer);
    this.iceCandidateTypes.delete(fromDeviceId);
    this.updateState(fromDeviceId, "connecting");

    // 启动连接超时计时器
    this.startConnectionTimeout(fromDeviceId, () =>
      this.handleConnectionTimeout(
        fromDeviceId,
        false,
        sendSignaling,
        retryCount,
        sdp,
      ),
    );

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.trackIceCandidateType(fromDeviceId, event.candidate);
        sendSignaling({
          type: "ice_candidate",
          payload: event.candidate.toJSON(),
          target: fromDeviceId,
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        console.log(`🧊 ICE gathering complete for ${fromDeviceId}`);
      }
    };

    pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange(
        fromDeviceId,
        pc,
        false,
        sendSignaling,
        retryCount,
      );
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignaling({
        type: "answer",
        payload: pc.localDescription,
        target: fromDeviceId,
      });
    } catch (err) {
      console.error(`Failed to handle offer from ${fromDeviceId}:`, err);
      this.handleConnectionFailure(
        fromDeviceId,
        false,
        sendSignaling,
        retryCount,
        err instanceof Error ? err.message : "处理 Offer 失败",
      );
    }
  }

  // ============================================================
  // 内部 — 超时处理
  // ============================================================

  /**
   * 启动连接超时计时器（30 秒）
   */
  private startConnectionTimeout(
    deviceId: string,
    onTimeout: () => void,
  ): void {
    // 清理旧定时器
    const existing = this.connectionTimeouts.get(deviceId);
    if (existing) clearTimeout(existing);

    const timeoutId = setTimeout(onTimeout, CONNECTION_TIMEOUT_MS);
    this.connectionTimeouts.set(deviceId, timeoutId);
  }

  /**
   * 处理连接超时
   */
  private handleConnectionTimeout(
    deviceId: string,
    isOffer: boolean,
    sendSignaling: SignalingSender,
    retryCount: number,
    originalSdp?: RTCSessionDescriptionInit,
  ): void {
    console.warn(
      `⏰ Connection timeout for ${deviceId} (${CONNECTION_TIMEOUT_MS / 1000}s)`,
    );
    this.connectionTimeouts.delete(deviceId);
    this.handleConnectionFailure(
      deviceId,
      isOffer,
      sendSignaling,
      retryCount,
      "ICE 连接超时（30 秒）",
      originalSdp,
    );
  }

  // ============================================================
  // 内部 — 连接失败与重试
  // ============================================================

  /**
   * 处理连接失败，决定是否重试
   */
  private handleConnectionFailure(
    deviceId: string,
    isOffer: boolean,
    sendSignaling: SignalingSender,
    retryCount: number,
    reason: string,
    originalSdp?: RTCSessionDescriptionInit,
  ): void {
    // 清理当前连接资源
    this.cleanupPeer(deviceId);

    if (retryCount < MAX_RETRY_COUNT) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
      console.warn(
        `🔄 Retrying connection to ${deviceId} in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRY_COUNT}): ${reason}`,
      );

      setTimeout(() => {
        this.retryConnection(
          deviceId,
          isOffer,
          sendSignaling,
          retryCount + 1,
          originalSdp,
        );
      }, delay);
    } else {
      console.error(
        `❌ Connection to ${deviceId} failed after ${MAX_RETRY_COUNT} retries: ${reason}`,
      );
      this.updateState(deviceId, "failed");
      this.activeConnectionAttempts = Math.max(
        0,
        this.activeConnectionAttempts - 1,
      );
      this.processQueue();
    }
  }

  /**
   * 重试连接
   */
  private retryConnection(
    deviceId: string,
    isOffer: boolean,
    sendSignaling: SignalingSender,
    retryCount: number,
    originalSdp?: RTCSessionDescriptionInit,
  ): void {
    if (isOffer) {
      this.doCreateOffer(deviceId, sendSignaling, retryCount);
    } else if (originalSdp) {
      this.doHandleOffer(deviceId, originalSdp, sendSignaling, retryCount);
    }
  }

  /**
   * 清理对等连接资源（不触发状态变更回调）
   */
  private cleanupPeer(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      try {
        peer.dc?.close();
      } catch {
        // 忽略关闭错误
      }
      try {
        peer.pc.close();
      } catch {
        // 忽略关闭错误
      }
      this.peers.delete(deviceId);
    }
  }

  // ============================================================
  // 内部 — DataChannel 事件
  // ============================================================

  /**
   * 设置 DataChannel 事件监听
   */
  private setupDataChannel(deviceId: string, dc: RTCDataChannel): void {
    dc.onopen = () => {
      console.log(`📡 DataChannel to ${deviceId} opened`);
      // 连接成功，清除超时
      const timeoutId = this.connectionTimeouts.get(deviceId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.connectionTimeouts.delete(deviceId);
      }
      this.updateState(deviceId, "connected");
      this.onDataChannelReady?.(deviceId, dc);
      // 减少活跃连接计数，处理队列
      this.activeConnectionAttempts = Math.max(
        0,
        this.activeConnectionAttempts - 1,
      );
      this.processQueue();
    };

    dc.onclose = () => {
      console.log(`📡 DataChannel to ${deviceId} closed`);
    };

    dc.onerror = (err) => {
      console.error(`DataChannel to ${deviceId} error:`, err);
    };
  }

  // ============================================================
  // 内部 — 连接状态变更
  // ============================================================

  /**
   * 处理 RTCPeerConnection 状态变更
   */
  private handleConnectionStateChange(
    deviceId: string,
    pc: RTCPeerConnection,
    isOffer: boolean,
    sendSignaling: SignalingSender,
    retryCount: number,
  ): void {
    switch (pc.connectionState) {
      case "connected":
        // 连接成功，清除超时
        {
          const timeoutId = this.connectionTimeouts.get(deviceId);
          if (timeoutId) {
            clearTimeout(timeoutId);
            this.connectionTimeouts.delete(deviceId);
          }
        }
        this.updateState(deviceId, "connected");
        break;

      case "disconnected":
        // 可能只是临时断开（ICE 重连中），不立即标记失败
        this.updateState(deviceId, "disconnected");
        break;

      case "failed":
        // 连接彻底失败
        this.handleConnectionFailure(
          deviceId,
          isOffer,
          sendSignaling,
          retryCount,
          "RTCPeerConnection 进入 failed 状态",
        );
        break;

      case "closed":
        this.updateState(deviceId, "disconnected");
        break;
    }
  }

  // ============================================================
  // 内部 — 状态管理
  // ============================================================

  /**
   * 更新并通知状态变更
   */
  private updateState(deviceId: string, state: ConnectionState): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.state = state;

      // 连接建立后确定实际通道类型
      if (state === "connected") {
        const channel = this.determineChannel(deviceId);
        peer.connectionChannel = channel;
        this.onChannelChange?.(deviceId, channel);
      }
    }
    this.onConnectionChange?.(deviceId, state);
  }

  /**
   * 追踪 ICE 候选类型（用于判定最终连接通道）
   */
  private trackIceCandidateType(
    deviceId: string,
    candidate: RTCIceCandidate,
  ): void {
    if (!candidate.candidate) return;

    // 从 SDP 候选字符串中提取类型
    // 格式: "candidate:... typ <type> ..."
    const match = candidate.candidate.match(/\btyp\s+(\S+)/);
    if (match) {
      let types = this.iceCandidateTypes.get(deviceId);
      if (!types) {
        types = new Set();
        this.iceCandidateTypes.set(deviceId, types);
      }
      types.add(match[1]);
    }
  }

  /**
   * 根据收集的 ICE 候选类型判定连接通道
   * - host / srflx → 局域网 P2P
   * - relay → TURN 中继
   */
  private determineChannel(deviceId: string): ConnectionChannel {
    const types = this.iceCandidateTypes.get(deviceId);
    if (!types || types.size === 0) return "lan_p2p"; // 默认局域网

    if (types.has("relay")) return "turn_relay";
    if (types.has("srflx") || types.has("host")) return "lan_p2p";
    return "lan_p2p";
  }
}

// 单例导出
export const webrtcService = new WebRTCService();
