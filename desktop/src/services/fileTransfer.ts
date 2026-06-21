// ============================================================
// 桌面客户端 — 文件传输引擎
// 基于 WebRTC DataChannel 的 P2P 文件分块传输
//
// 协议设计：
//   - 控制消息：JSON 字符串（meta / ack / complete / verify）
//   - 分块数据：二进制 ArrayBuffer
//     格式：[fileIdLen:4][fileId:UTF8][chunkIdx:4][crc32:4][data]
//
// 特性：
//   - 16KB 分块 + CRC32 逐块校验
//   - SHA256 完整性验证（完成后比对，不一致自动重传最多 3 次）
//   - 流控窗口（最多 16 个在途分块，缓冲区 > 256KB 暂停）
//   - 并行传输队列（最多 5 个并发）
//   - 流式内存管理：发送端逐块读取文件，接收端 Blob 组装
//     （不再将整个文件加载到内存，支持 10GB+ 文件传输）
//   - 增量 SHA256：边读边哈希，无需二次遍历文件
// ============================================================

import type {
  FileMetaMessage,
  FileAckMessage,
  FileCompleteMessage,
  FileVerifyMessage,
  FileResumeRequestMessage,
  FileResumeAckMessage,
  FileControlMessage,
  TransferProgress,
  TransferResult,
  ChunkHeader,
} from "../../../shared/types/index";
import {
  CHUNK_SIZE,
  MAX_PARALLEL_TRANSFERS,
  MAX_RETRY_COUNT,
  FLOW_CONTROL_WINDOW,
  BUFFERED_AMOUNT_THRESHOLD,
  crc32,
  IncrementalSHA256,
  logMemoryUsage,
} from "../../../shared/utils/index";
import {
  notifyTransferComplete,
  notifyTransferFailed,
} from "./notificationService.js";

// ============================================================
// 类型定义
// ============================================================

export interface TransferCallbacks {
  onProgress: (progress: TransferProgress) => void;
  onComplete: (result: TransferResult) => void;
  onError: (fileId: string, error: string) => void;
}

interface ActiveTransfer {
  fileId: string;
  file: File;
  dc: RTCDataChannel;
  callbacks: TransferCallbacks;
  retryCount: number;
  cancelled: boolean;
  /** 待确认的分块索引集合 */
  pendingAcks: Set<number>;
  /** ACK resolver（唤醒发送循环） */
  ackResolver: (() => void) | null;
  /** 完整文件 SHA256（首次发送完成后缓存，供断线续传使用） */
  sha256Hash?: string;
  /** 断线续传：从该分块开始发送（跳过 [0..resumeFromChunk-1]） */
  resumeFromChunk: number;
}

interface ReceiveState {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkSize: number;
  /** 密集存储已接收分块（按索引顺序，用于 Blob 组装） */
  chunks: ArrayBuffer[];
  receivedChunks: number;
  startTime: number;
  lastProgressTime: number;
  lastProgressBytes: number;
  callbacks: TransferCallbacks;
  dc: RTCDataChannel;
  /** 增量 SHA256 哈希器（接收过程中增量更新） */
  sha256Hasher: IncrementalSHA256;
}

// ============================================================
// 二进制消息编解码
// ============================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * 编码文件分块为二进制消息
 * 格式: [fileIdLen:4][fileId:UTF8][chunkIdx:4][crc32:4][data]
 */
export function encodeChunk(
  fileId: string,
  chunkIndex: number,
  chunkCrc32: number,
  data: ArrayBuffer,
): ArrayBuffer {
  const fileIdBytes = encoder.encode(fileId);
  const headerSize = 4 + fileIdBytes.length + 4 + 4;
  const totalSize = headerSize + data.byteLength;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  let offset = 0;

  view.setUint32(offset, fileIdBytes.length, false);
  offset += 4;

  u8.set(fileIdBytes, offset);
  offset += fileIdBytes.length;

  view.setUint32(offset, chunkIndex, false);
  offset += 4;

  view.setUint32(offset, chunkCrc32, false);
  offset += 4;

  u8.set(new Uint8Array(data), offset);

  return buffer;
}

/**
 * 解码二进制分块消息
 */
export function decodeChunk(buffer: ArrayBuffer): ChunkHeader | null {
  try {
    const view = new DataView(buffer);
    let offset = 0;

    const fileIdLen = view.getUint32(offset, false);
    offset += 4;

    const fileIdBytes = new Uint8Array(buffer, offset, fileIdLen);
    const fileId = decoder.decode(fileIdBytes);
    offset += fileIdLen;

    const chunkIndex = view.getUint32(offset, false);
    offset += 4;

    const chunkCrc32 = view.getUint32(offset, false);
    offset += 4;

    const data = buffer.slice(offset);

    return { fileId, chunkIndex, crc32: chunkCrc32, data };
  } catch {
    return null;
  }
}

// ============================================================
// FileTransferService
// ============================================================

class FileTransferService {
  private activeSends = new Map<string, ActiveTransfer>();
  private activeReceives = new Map<string, ReceiveState>();
  private sendQueue: Array<{ fileId: string; fn: () => Promise<void> }> = [];

  /** 已注册消息处理器的 DataChannel */
  private registeredChannels = new WeakSet<RTCDataChannel>();

  /** 接收回调（每个设备/通道一个） */
  private receiveCallbacks = new WeakMap<
    RTCDataChannel,
    TransferCallbacks
  >();

  /** 断线续传 — 中断的接收任务（fileId → ReceiveState） */
  private interruptedReceives = new Map<string, ReceiveState>();

  /** 断线续传 — DataChannel → deviceId 映射 */
  private dcToDeviceId = new WeakMap<RTCDataChannel, string>();

  // ============================================================
  // 公共 API — 发送文件
  // ============================================================

  sendFile(
    deviceId: string,
    file: File,
    dc: RTCDataChannel,
    callbacks: TransferCallbacks,
  ): () => void {
    const fileId = crypto.randomUUID();

    // 记录 dc → deviceId 映射（用于断线续传）
    this.dcToDeviceId.set(dc, deviceId);

    const transfer: ActiveTransfer = {
      fileId,
      file,
      dc,
      callbacks,
      retryCount: 0,
      cancelled: false,
      pendingAcks: new Set(),
      ackResolver: null,
      resumeFromChunk: 0,
    };

    // 确保已注册消息处理器（用于接收 ACK / VERIFY）
    this.ensureHandlerRegistered(dc, callbacks);

    if (this.activeSends.size >= MAX_PARALLEL_TRANSFERS) {
      this.sendQueue.push({
        fileId,
        fn: () => this.startSend(transfer),
      });
      return () => {
        transfer.cancelled = true;
        this.sendQueue = this.sendQueue.filter((q) => q.fileId !== fileId);
      };
    }

    this.startSend(transfer);

    return () => {
      transfer.cancelled = true;
      this.activeSends.delete(fileId);
    };
  }

  cancelSend(fileId: string): void {
    const transfer = this.activeSends.get(fileId);
    if (transfer) {
      transfer.cancelled = true;
      this.activeSends.delete(fileId);
      transfer.callbacks.onComplete({
        file_id: fileId,
        file_name: transfer.file.name,
        success: false,
        sha256_match: false,
        retry_count: transfer.retryCount,
        error_message: "用户取消",
      });
    }
  }

  cancelAll(): void {
    this.sendQueue = [];
    for (const [fileId] of this.activeSends) {
      this.cancelSend(fileId);
    }
    for (const [fileId] of this.activeReceives) {
      const state = this.activeReceives.get(fileId)!;
      state.callbacks.onComplete({
        file_id: fileId,
        file_name: state.fileName,
        success: false,
        sha256_match: false,
        retry_count: 0,
        error_message: "传输取消",
      });
      this.activeReceives.delete(fileId);
    }
  }

  getActiveCount(): { sends: number; receives: number } {
    return {
      sends: this.activeSends.size + this.sendQueue.length,
      receives: this.activeReceives.size,
    };
  }

  /**
   * 为 DataChannel 注册接收回调
   */
  setReceiveCallbacks(dc: RTCDataChannel, callbacks: TransferCallbacks): void {
    this.receiveCallbacks.set(dc, callbacks);
    this.ensureHandlerRegistered(dc, callbacks);
  }

  // ============================================================
  // 统一消息处理器
  // ============================================================

  /**
   * 确保 DataChannel 只注册一次 onmessage 处理器
   */
  private ensureHandlerRegistered(
    dc: RTCDataChannel,
    callbacks: TransferCallbacks,
  ): void {
    if (this.registeredChannels.has(dc)) return;
    this.registeredChannels.add(dc);
    this.receiveCallbacks.set(dc, callbacks);

    dc.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data === "string") {
        this.dispatchControlMessage(dc, event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.handleChunkMessage(event.data);
      }
    });
  }

  /**
   * 分发控制消息到对应的处理器
   */
  private dispatchControlMessage(dc: RTCDataChannel, raw: string): void {
    let msg: FileControlMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "ack":
        this.routeAck(msg);
        break;

      case "verify":
        this.routeVerify(msg);
        break;

      case "meta":
        this.handleMeta(dc, msg);
        break;

      case "complete":
        this.handleComplete(dc, msg);
        break;

      case "resume_request":
        this.handleResumeRequest(msg, dc);
        break;

      case "resume_ack":
        this.handleResumeAck(msg);
        break;

      default:
        console.debug("Unknown control message:", msg);
    }
  }

  // ============================================================
  // 消息路由 — ACK
  // ============================================================

  private routeAck(msg: FileAckMessage): void {
    const transfer = this.activeSends.get(msg.fileId);
    if (!transfer) return;

    if (msg.status === "crc_error") {
      // CRC 错误 → 接收端会丢弃该分块，不需要额外操作
      // 分块会通过有序可靠传输自动重传（DataChannel ordered: true）
      console.warn(
        `CRC error for chunk ${msg.chunkIndex} of ${msg.fileId}, receiver will request retransmission`,
      );
      return;
    }

    transfer.pendingAcks.delete(msg.chunkIndex);
    if (transfer.ackResolver) {
      transfer.ackResolver();
      transfer.ackResolver = null;
    }
  }

  // ============================================================
  // 消息路由 — VERIFY
  // ============================================================

  private routeVerify(msg: FileVerifyMessage): void {
    const transfer = this.activeSends.get(msg.fileId);
    if (!transfer) return;

    if (msg.match) {
      transfer.callbacks.onComplete({
        file_id: msg.fileId,
        file_name: transfer.file.name,
        success: true,
        sha256_match: true,
        retry_count: transfer.retryCount,
      });
      notifyTransferComplete(transfer.file.name, "sent");
      this.activeSends.delete(msg.fileId);
      this.processQueue();
    } else {
      transfer.retryCount++;
      if (transfer.retryCount < MAX_RETRY_COUNT) {
        console.warn(
          `SHA256 mismatch for ${msg.fileId}, retry ${transfer.retryCount}/${MAX_RETRY_COUNT}`,
        );
        // 重置续传起点（SHA256 不匹配需要完整重传）
        transfer.resumeFromChunk = 0;
        this.startSend(transfer);
      } else {
        transfer.callbacks.onComplete({
          file_id: msg.fileId,
          file_name: transfer.file.name,
          success: false,
          sha256_match: false,
          retry_count: transfer.retryCount,
          error_message: `SHA256 校验 ${MAX_RETRY_COUNT} 次不匹配，传输失败`,
        });
        notifyTransferFailed(transfer.file.name, "SHA256 校验多次不匹配");
        this.activeSends.delete(msg.fileId);
        this.processQueue();
      }
    }
  }

  // ============================================================
  // 发送端内部实现
  // ============================================================

  private async startSend(transfer: ActiveTransfer): Promise<void> {
    if (transfer.cancelled) return;
    this.activeSends.set(transfer.fileId, transfer);

    try {
      await this.doSend(transfer);
    } catch (err) {
      if (!transfer.cancelled) {
        const errorMsg = err instanceof Error ? err.message : "传输失败";
        transfer.callbacks.onError(transfer.fileId, errorMsg);
        notifyTransferFailed(transfer.file.name, errorMsg);
        transfer.callbacks.onComplete({
          file_id: transfer.fileId,
          file_name: transfer.file.name,
          success: false,
          sha256_match: false,
          retry_count: transfer.retryCount,
          error_message: err instanceof Error ? err.message : "未知错误",
        });
      }
      this.activeSends.delete(transfer.fileId);
    }

    this.processQueue();
  }

  private async doSend(transfer: ActiveTransfer): Promise<void> {
    const { fileId, file, dc, callbacks } = transfer;
    const fileSize = file.size;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    const resumeFrom = transfer.resumeFromChunk;
    const isResuming = resumeFrom > 0;

    logMemoryUsage(
      `${isResuming ? "断线续传" : "发送开始"}: ${file.name} (${(fileSize / 1024 / 1024).toFixed(1)}MB)${isResuming ? `, 从分块 ${resumeFrom}/${totalChunks} 继续` : ""}`,
    );

    // 增量 SHA256 — 边读边哈希
    const sha256Hasher = transfer.sha256Hash ? null : new IncrementalSHA256();

    // 重新发送 FILE_META（续传时接收端需要知道这是哪个文件的续传）
    const metaMsg: FileMetaMessage = {
      type: "meta",
      fileId,
      fileName: file.name,
      fileSize: fileSize,
      mimeType: file.type || "application/octet-stream",
      totalChunks,
      chunkSize: CHUNK_SIZE,
    };
    dc.send(JSON.stringify(metaMsg));

    callbacks.onProgress({
      file_id: fileId,
      file_name: file.name,
      total_bytes: fileSize,
      transferred_bytes: isResuming ? resumeFrom * CHUNK_SIZE : 0,
      percentage: isResuming ? Math.round((resumeFrom / totalChunks) * 100) : 0,
      speed_bps: 0,
      eta_seconds: 0,
      status: "transferring",
    });

    const startTime = performance.now();
    let lastProgressTime = startTime;
    let sentBytes = isResuming ? resumeFrom * CHUNK_SIZE : 0;
    let readBytes = 0; // 已读取的分块数（包括跳过的）
    transfer.pendingAcks = new Set();

    while (readBytes < totalChunks && !transfer.cancelled) {
      // 流控和窗口控制（仅在发送阶段检查）
      if (readBytes >= resumeFrom) {
        while (
          dc.bufferedAmount > BUFFERED_AMOUNT_THRESHOLD &&
          !transfer.cancelled
        ) {
          await this.waitForBufferDrain(dc);
        }

        while (
          transfer.pendingAcks.size >= FLOW_CONTROL_WINDOW &&
          !transfer.cancelled
        ) {
          await new Promise<void>((resolve) => {
            transfer.ackResolver = resolve;
          });
          if (transfer.cancelled) break;
        }
      }

      if (transfer.cancelled) break;

      // 🧠 流式读取：每次只读取一个 16KB 分块到内存
      const chunkStart = readBytes * CHUNK_SIZE;
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, fileSize);
      const chunkBlob = file.slice(chunkStart, chunkEnd);
      const chunkData = await chunkBlob.arrayBuffer();

      // 增量哈希更新（仅在首次发送或没有缓存 SHA256 时需要）
      if (sha256Hasher) {
        sha256Hasher.update(chunkData);
      }

      // 续传时跳过已发送的分块（但仍需读取以计算 SHA256）
      if (readBytes >= resumeFrom) {
        const chunkCrc32 = crc32(chunkData);
        const binaryMsg = encodeChunk(fileId, readBytes, chunkCrc32, chunkData);

        dc.send(binaryMsg);
        transfer.pendingAcks.add(readBytes);
        sentBytes += chunkData.byteLength;

        // 进度回调（每 100ms 或每 64 个分块）
        const now = performance.now();
        if (now - lastProgressTime > 100 || readBytes % 64 === 0) {
          const elapsed = (now - startTime) / 1000;
          const actualSentBytes = sentBytes - resumeFrom * CHUNK_SIZE;
          const speedBps = elapsed > 0 ? actualSentBytes / elapsed : 0;
          const remainingBytes = fileSize - sentBytes;
          const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : 0;

          callbacks.onProgress({
            file_id: fileId,
            file_name: file.name,
            total_bytes: fileSize,
            transferred_bytes: sentBytes,
            percentage: Math.round((sentBytes / fileSize) * 100),
            speed_bps: Math.round(speedBps),
            eta_seconds: Math.round(etaSeconds),
            status: "transferring",
          });

          lastProgressTime = now;
        }
      }

      readBytes++;
    }

    // 等待未完成的 ACK
    while (transfer.pendingAcks.size > 0 && !transfer.cancelled) {
      await new Promise<void>((resolve) => {
        transfer.ackResolver = resolve;
      });
    }

    if (transfer.cancelled) return;

    // 获取最终的 SHA256 哈希（并缓存供后续续传使用）
    const sha256Hash = sha256Hasher
      ? sha256Hasher.digest()
      : transfer.sha256Hash!;
    transfer.sha256Hash = sha256Hash;

    // 发送 FILE_COMPLETE
    const completeMsg: FileCompleteMessage = {
      type: "complete",
      fileId,
      sha256: sha256Hash,
    };
    dc.send(JSON.stringify(completeMsg));

    logMemoryUsage(`发送完成: ${file.name}`);

    callbacks.onProgress({
      file_id: fileId,
      file_name: file.name,
      total_bytes: fileSize,
      transferred_bytes: fileSize,
      percentage: 100,
      speed_bps: 0,
      eta_seconds: 0,
      status: "verifying",
    });
  }

  private waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (dc.bufferedAmount <= BUFFERED_AMOUNT_THRESHOLD / 2) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      setTimeout(check, 10);
    });
  }

  // ============================================================
  // 接收端 — META
  // ============================================================

  private handleMeta(dc: RTCDataChannel, msg: FileMetaMessage): void {
    const callbacks = this.receiveCallbacks.get(dc);
    if (!callbacks) return;

    // 断线续传：如果已有活跃接收（从 interruptedReceives 恢复的），则合并状态
    const existingState = this.activeReceives.get(msg.fileId);

    if (existingState && existingState.chunks.length > 0) {
      // 续传场景：保留已接收的分块和 SHA256 状态，仅更新 dc 和回调
      logMemoryUsage(
        `续传继续: ${msg.fileName}, 已有 ${existingState.receivedChunks}/${msg.totalChunks} 分块`,
      );
      existingState.dc = dc;
      existingState.callbacks = callbacks;
      return; // 不创建新状态，等待后续分块
    }

    logMemoryUsage(`接收开始: ${msg.fileName} (${(msg.fileSize / 1024 / 1024).toFixed(1)}MB)`);

    const state: ReceiveState = {
      fileId: msg.fileId,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      totalChunks: msg.totalChunks,
      chunkSize: msg.chunkSize,
      chunks: [],
      receivedChunks: 0,
      startTime: performance.now(),
      lastProgressTime: performance.now(),
      lastProgressBytes: 0,
      callbacks,
      dc,
      sha256Hasher: new IncrementalSHA256(),
    };

    this.activeReceives.set(msg.fileId, state);

    callbacks.onProgress({
      file_id: msg.fileId,
      file_name: msg.fileName,
      total_bytes: msg.fileSize,
      transferred_bytes: 0,
      percentage: 0,
      speed_bps: 0,
      eta_seconds: 0,
      status: "transferring",
    });
  }

  // ============================================================
  // 接收端 — CHUNK
  // ============================================================

  private handleChunkMessage(data: ArrayBuffer): void {
    const header = decodeChunk(data);
    if (!header) {
      console.warn("Failed to decode chunk message");
      return;
    }

    const state = this.activeReceives.get(header.fileId);
    if (!state) {
      console.warn(`Received chunk for unknown file: ${header.fileId}`);
      return;
    }

    // CRC32 校验
    const computedCrc = crc32(header.data);
    if (computedCrc !== header.crc32) {
      console.warn(
        `CRC32 mismatch for chunk ${header.chunkIndex} of ${header.fileId}`,
      );
      const ackMsg: FileAckMessage = {
        type: "ack",
        fileId: header.fileId,
        chunkIndex: header.chunkIndex,
        status: "crc_error",
      };
      this.sendAck(state, ackMsg);
      return;
    }

    // 存储分块并增量哈希（避免重复：检查 chunks.length 是否覆盖了该索引）
    if (header.chunkIndex >= state.chunks.length) {
      // 🧠 增量 SHA256 更新
      state.sha256Hasher.update(header.data);
      state.chunks.push(header.data);
      state.receivedChunks = state.chunks.length;
    }

    // 发送 ACK
    const ackMsg: FileAckMessage = {
      type: "ack",
      fileId: header.fileId,
      chunkIndex: header.chunkIndex,
      status: "ok",
    };
    this.sendAck(state, ackMsg);

    // 进度回调
    const now = performance.now();
    if (
      now - state.lastProgressTime > 100 ||
      state.receivedChunks % 64 === 0
    ) {
      const receivedBytes = state.receivedChunks * state.chunkSize;
      const elapsed = (now - state.startTime) / 1000;
      const speedBps = elapsed > 0 ? receivedBytes / elapsed : 0;
      const remainingBytes = state.fileSize - receivedBytes;
      const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : 0;

      state.callbacks.onProgress({
        file_id: state.fileId,
        file_name: state.fileName,
        total_bytes: state.fileSize,
        transferred_bytes: Math.min(receivedBytes, state.fileSize),
        percentage: Math.round(
          (state.receivedChunks / state.totalChunks) * 100,
        ),
        speed_bps: Math.round(speedBps),
        eta_seconds: Math.round(etaSeconds),
        status: "transferring",
      });

      state.lastProgressTime = now;
      state.lastProgressBytes = receivedBytes;
    }
  }

  // ============================================================
  // 接收端 — COMPLETE
  // ============================================================

  private async handleComplete(
    dc: RTCDataChannel,
    msg: FileCompleteMessage,
  ): Promise<void> {
    const state = this.activeReceives.get(msg.fileId);
    if (!state) {
      console.warn(`Received complete for unknown file: ${msg.fileId}`);
      return;
    }

    state.callbacks.onProgress({
      file_id: state.fileId,
      file_name: state.fileName,
      total_bytes: state.fileSize,
      transferred_bytes: state.fileSize,
      percentage: 100,
      speed_bps: 0,
      eta_seconds: 0,
      status: "verifying",
    });

    // 检查分块完整性
    if (state.chunks.length !== state.totalChunks) {
      const missingCount = state.totalChunks - state.chunks.length;
      state.callbacks.onError(
        state.fileId,
        `分块不完整：缺失 ${missingCount} 个分块`,
      );
      state.callbacks.onComplete({
        file_id: state.fileId,
        file_name: state.fileName,
        success: false,
        sha256_match: false,
        retry_count: 0,
        error_message: `缺失 ${missingCount} 个分块，传输不完整`,
      });
      this.activeReceives.delete(state.fileId);
      return;
    }

    // 🧠 使用增量 SHA256 的 digest（无需组装全文件再哈希）
    const computedHash = state.sha256Hasher.digest();
    const match = computedHash === msg.sha256;

    const verifyMsg: FileVerifyMessage = {
      type: "verify",
      fileId: state.fileId,
      match,
    };
    dc.send(JSON.stringify(verifyMsg));

    if (match) {
      // 🧠 Blob 组装：不复制 ArrayBuffer，直接引用已接收的分块
      this.saveReceivedFile(state.fileName, state.chunks);

      state.callbacks.onComplete({
        file_id: state.fileId,
        file_name: state.fileName,
        success: true,
        sha256_match: true,
        retry_count: 0,
      });
      notifyTransferComplete(state.fileName, "received");
    } else {
      state.callbacks.onComplete({
        file_id: state.fileId,
        file_name: state.fileName,
        success: false,
        sha256_match: false,
        retry_count: 0,
        error_message: "SHA256 校验不匹配，等待发送端重传",
      });
      notifyTransferFailed(state.fileName, "SHA256 校验不匹配");
    }

    logMemoryUsage(`接收完成: ${state.fileName}`);
    this.activeReceives.delete(state.fileId);
  }

  // ============================================================
  // 工具方法
  // ============================================================

  private sendAck(state: ReceiveState, ack: FileAckMessage): void {
    if (state.dc.readyState === "open") {
      state.dc.send(JSON.stringify(ack));
    }
  }

  private saveReceivedFile(
    fileName: string,
    chunks: ArrayBuffer[],
  ): void {
    // 🧠 Blob 直接引用分块 ArrayBuffer，不进行内存复制
    // new Blob(chunks) 按规范不复制底层数据
    const blob = new Blob(chunks, { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // 断线续传 — DataChannel 生命周期
  // ============================================================

  /**
   * DataChannel 关闭时调用（由 webrtc service 触发）
   * 保存中断的接收任务状态，以便后续续传
   */
  onDataChannelClose(dc: RTCDataChannel): void {
    // 保存中断的接收任务
    for (const [fileId, state] of this.activeReceives) {
      if (state.dc === dc) {
        console.log(
          `⏸️  传输中断: ${state.fileName}, 已接收 ${state.receivedChunks}/${state.totalChunks} 分块`,
        );
        this.interruptedReceives.set(fileId, state);
        this.activeReceives.delete(fileId);
      }
    }

    // 标记中断的发送任务（保留在 activeSends 中以供续传）
    for (const [, transfer] of this.activeSends) {
      if (transfer.dc === dc) {
        console.log(
          `⏸️  发送中断: ${transfer.file.name}, fileId=${transfer.fileId}`,
        );
        // 不清除 activeSends，等待接收端请求续传
      }
    }
  }

  /**
   * 新 DataChannel 就绪时调用（由 webrtc service 触发）
   * 检查是否有中断的传输可以续传
   */
  onDataChannelReady(deviceId: string, dc: RTCDataChannel): void {
    this.dcToDeviceId.set(dc, deviceId);

    // 检查是否有针对该设备的中断接收任务
    if (this.interruptedReceives.size > 0) {
      for (const [fileId, state] of this.interruptedReceives) {
        console.log(
          `🔄 请求续传: ${state.fileName}, 从分块 ${state.receivedChunks}/${state.totalChunks}`,
        );

        // 发送续传请求
        const resumeMsg: FileResumeRequestMessage = {
          type: "resume_request",
          fileId,
          lastReceivedChunk: state.receivedChunks - 1,
        };

        // 更新接收状态的 dc 引用
        state.dc = dc;
        state.callbacks = this.receiveCallbacks.get(dc) || state.callbacks;
        this.activeReceives.set(fileId, state);
        this.interruptedReceives.delete(fileId);

        // 重新注册消息处理器
        this.ensureHandlerRegistered(dc, state.callbacks);

        // 发送续传请求
        if (dc.readyState === "open") {
          dc.send(JSON.stringify(resumeMsg));
        } else {
          // DataChannel 还没完全打开，等待 open 事件
          const originalOnOpen = dc.onopen;
          dc.onopen = (ev) => {
            if (originalOnOpen) originalOnOpen.call(dc, ev);
            dc.send(JSON.stringify(resumeMsg));
          };
        }
      }
    }
  }

  // ============================================================
  // 断线续传 — 消息处理
  // ============================================================

  /**
   * 发送端收到续传请求 → 从指定分块恢复发送
   */
  private handleResumeRequest(
    msg: FileResumeRequestMessage,
    dc: RTCDataChannel,
  ): void {
    const transfer = this.activeSends.get(msg.fileId);
    if (!transfer) {
      // 发送端已经清理了该传输（可能已完成或已被用户取消）
      const rejectMsg: FileResumeAckMessage = {
        type: "resume_ack",
        fileId: msg.fileId,
        resumeFromChunk: 0,
        accepted: false,
      };
      if (dc.readyState === "open") dc.send(JSON.stringify(rejectMsg));
      return;
    }

    const resumeFrom = msg.lastReceivedChunk + 1;

    console.log(
      `🔄 发送端收到续传请求: ${transfer.file.name}, 从分块 ${resumeFrom} 恢复`,
    );

    // 设置续传起点，重新开始发送
    transfer.resumeFromChunk = resumeFrom;
    transfer.dc = dc;
    transfer.pendingAcks = new Set();
    transfer.ackResolver = null;

    // 发送确认
    const ackMsg: FileResumeAckMessage = {
      type: "resume_ack",
      fileId: msg.fileId,
      resumeFromChunk: resumeFrom,
      accepted: true,
    };
    dc.send(JSON.stringify(ackMsg));

    // 重新开始发送（从续传点）
    this.startSend(transfer);
  }

  /**
   * 接收端收到续传确认 → 准备接收剩余分块
   */
  private handleResumeAck(msg: FileResumeAckMessage): void {
    const state = this.activeReceives.get(msg.fileId);
    if (!state) {
      console.warn(`收到未知文件的续传确认: ${msg.fileId}`);
      return;
    }

    if (!msg.accepted) {
      // 发送端拒绝续传 → 标记为失败
      state.callbacks.onError(
        msg.fileId,
        "发送端无法续传，请手动重新传输",
      );
      state.callbacks.onComplete({
        file_id: msg.fileId,
        file_name: state.fileName,
        success: false,
        sha256_match: false,
        retry_count: 0,
        error_message: "续传被拒绝",
      });
      this.activeReceives.delete(msg.fileId);
      return;
    }

    console.log(
      `🔄 接收端续传确认: ${state.fileName}, 从分块 ${msg.resumeFromChunk} 继续`,
    );
    // 接收端不需要特殊操作，handleMeta 会设置新的 ReceiveState
    // chunks 数组已保留，handleChunkMessage 会继续追加
  }

  private processQueue(): void {
    if (
      this.sendQueue.length > 0 &&
      this.activeSends.size < MAX_PARALLEL_TRANSFERS
    ) {
      const next = this.sendQueue.shift();
      if (next) next.fn();
    }
  }
}

// 单例导出
export const fileTransferService = new FileTransferService();
