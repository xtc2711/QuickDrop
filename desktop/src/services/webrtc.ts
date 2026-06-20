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
}

type ConnectionCallback = (deviceId: string, state: ConnectionState) => void;
type DataChannelCallback = (deviceId: string, dc: RTCDataChannel) => void;

/** 发送信令消息的回调签名 */
export type SignalingSender = (msg: {
  type: string;
  payload: unknown;
  target: string;
}) => void;

class WebRTCService {
  /** deviceId → PeerState */
  private peers = new Map<string, PeerState>();

  /** 回调：连接状态变更 */
  private onConnectionChange: ConnectionCallback | null = null;
  /** 回调：DataChannel 就绪 */
  private onDataChannelReady: DataChannelCallback | null = null;

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
   * 断开与指定设备的连接
   */
  disconnect(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.dc?.close();
      peer.pc.close();
      this.peers.delete(deviceId);
      this.updateState(deviceId, "disconnected");
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const [deviceId] of this.peers) {
      this.disconnect(deviceId);
    }
    this.peers.clear();
  }

  // ========== Offer 侧（发起方） ==========

  /**
   * 作为发起方创建对等连接并生成 DataChannel
   * @param deviceId 目标设备 ID
   * @param sendSignaling 发送信令消息的回调（通过 WebSocket）
   */
  async createOffer(
    deviceId: string,
    sendSignaling: SignalingSender,
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
          payload: event.candidate.toJSON(),
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

  // ========== Answer 侧（接收方） ==========

  /**
   * 处理收到的 Offer，创建 Answer
   */
  async handleOffer(
    fromDeviceId: string,
    sdp: RTCSessionDescriptionInit,
    sendSignaling: SignalingSender,
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
          payload: event.candidate.toJSON(),
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

  // ========== 内部方法 ==========

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
  private handleConnectionStateChange(
    deviceId: string,
    pc: RTCPeerConnection,
  ): void {
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

  /**
   * 更新并通知状态变更
   */
  private updateState(deviceId: string, state: ConnectionState): void {
    const peer = this.peers.get(deviceId);
    if (peer) {
      peer.state = state;
    }
    this.onConnectionChange?.(deviceId, state);
  }
}

// 单例导出
export const webrtcService = new WebRTCService();
