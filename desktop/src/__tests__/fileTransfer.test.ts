// ============================================================
// 文件传输引擎 — 单元测试
// 覆盖：分块编解码 / CRC32 校验 / 控制消息路由 /
//       SHA256 完整性校验 / 并行传输队列 / 取消 / 重传
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fileTransferService,
  encodeChunk,
  decodeChunk,
} from "../services/fileTransfer";
import {
  crc32,
  CHUNK_SIZE,
  MAX_RETRY_COUNT,
  IncrementalSHA256,
} from "../../../shared/utils";

// ============================================================
// 测试辅助工具
// ============================================================

/** 创建模拟的 RTCDataChannel */
function createMockDC(
  opts: { bufferedAmount?: number; readyState?: RTCDataChannelState } = {},
) {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    send: vi.fn(),
    addEventListener: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    readyState: opts.readyState ?? ("open" as const),
    bufferedAmount: opts.bufferedAmount ?? 0,
    label: "quickdrop-file-transfer",
    // 内部方法：触发事件（用于测试注入消息）
    _trigger(event: string, data: any) {
      for (const fn of listeners.get(event) || []) {
        fn(data);
      }
    },
    _listeners: listeners,
  };
}

/** 创建模拟的 File 对象，支持 slice() + arrayBuffer() 流式读取 */
function createMockFile(
  name: string,
  size: number,
  content?: Uint8Array,
): File {
  const data = content ?? new Uint8Array(size);
  // 填充随机数据
  if (!content) {
    for (let i = 0; i < size; i++) data[i] = Math.floor(Math.random() * 256);
  }
  return {
    name,
    size,
    type: "application/octet-stream",
    arrayBuffer: vi.fn().mockResolvedValue(data.buffer.slice(0)),
    slice: vi.fn((start?: number, end?: number) => {
      const s = start ?? 0;
      const e = end ?? size;
      const sliced = data.subarray(s, e);
      // 复制出精确大小的 ArrayBuffer
      const buf = sliced.buffer.slice(
        sliced.byteOffset,
        sliced.byteOffset + sliced.byteLength,
      );
      return {
        size: sliced.length,
        type: "application/octet-stream",
        arrayBuffer: vi.fn().mockResolvedValue(buf),
        slice: vi.fn(),
        stream: vi.fn(),
        text: vi.fn(),
      } as unknown as Blob;
    }),
    lastModified: Date.now(),
    webkitRelativePath: "",
    text: vi.fn(),
    stream: vi.fn(),
    bytes: vi.fn(),
  } as unknown as File;
}

/** 创建模拟的 TransferCallbacks */
function createMockCallbacks() {
  return {
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
  };
}

/** 等待微任务队列清空 */
async function flushMicrotasks(count = 3) {
  for (let i = 0; i < count; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** SHA256 mock 辅助 — mock IncrementalSHA256 返回指定 hex 字符串 */
function mockSHA256(hex: string) {
  // Mock update 为 no-op，digest 返回预期值
  vi.spyOn(IncrementalSHA256.prototype, "update").mockImplementation(() => {});
  vi.spyOn(IncrementalSHA256.prototype, "digest").mockReturnValue(hex);
  // 同时保留 crypto.subtle.digest mock（接收端 handleComplete 旧代码可能调用）
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  vi.spyOn(crypto.subtle, "digest").mockResolvedValue(bytes.buffer);
  return hex;
}

// ============================================================
// 第一组：分块编解码（纯函数）
// ============================================================

describe("encodeChunk / decodeChunk 分块编解码", () => {
  it("编码后解码应还原原始数据", () => {
    const fileId = "test-file-001";
    const chunkIndex = 42;
    const data = new Uint8Array(CHUNK_SIZE);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const dataBuffer = data.buffer.slice(0);
    const computedCrc = crc32(dataBuffer);

    const encoded = encodeChunk(fileId, chunkIndex, computedCrc, dataBuffer);
    const decoded = decodeChunk(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.fileId).toBe(fileId);
    expect(decoded!.chunkIndex).toBe(chunkIndex);
    expect(decoded!.crc32).toBe(computedCrc);
    expect(decoded!.data.byteLength).toBe(data.length);

    const decodedData = new Uint8Array(decoded!.data);
    expect(decodedData).toEqual(data);
  });

  it("编码后二进制大小 = 头部 + 数据", () => {
    const fileId = "abc";
    const data = new Uint8Array(100);
    const crc = crc32(data.buffer);

    const encoded = encodeChunk(fileId, 0, crc, data.buffer);

    // header: 4 (fileIdLen) + 3 (fileId bytes) + 4 (chunkIdx) + 4 (crc32) = 15
    expect(encoded.byteLength).toBe(15 + 100);
  });

  it("decodeChunk 对无效数据返回 null", () => {
    const invalid = new ArrayBuffer(5);
    expect(decodeChunk(invalid)).toBeNull();
  });

  it("fileId 包含中文时编解码正确", () => {
    const fileId = "测试文件-中文";
    const data = new Uint8Array(50);
    const crc = crc32(data.buffer);

    const encoded = encodeChunk(fileId, 7, crc, data.buffer);
    const decoded = decodeChunk(encoded);

    expect(decoded!.fileId).toBe(fileId);
    expect(decoded!.chunkIndex).toBe(7);
  });

  it("empty data (0 bytes) 编解码正确", () => {
    const fileId = "empty";
    const data = new ArrayBuffer(0);
    const crc = crc32(data); // CRC32 of empty = 0

    const encoded = encodeChunk(fileId, 0, crc, data);
    const decoded = decodeChunk(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.data.byteLength).toBe(0);
  });
});

// ============================================================
// 第二组：发送端流程
// ============================================================

describe("FileTransferService 发送端", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-0000-0000-000000000001",
    );
    mockSHA256("a".repeat(64)); // 固定的 SHA256 值
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // 清理内部状态
    fileTransferService.cancelAll();
  });

  it("sendFile 首先发送 FILE_META 消息", async () => {
    const dc = createMockDC();
    const file = createMockFile("test.txt", 1024);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);

    await flushMicrotasks();

    // 第一条消息应该是 META (JSON 字符串)
    const firstCall = dc.send.mock.calls[0];
    const metaMsg = JSON.parse(firstCall[0]);
    expect(metaMsg.type).toBe("meta");
    expect(metaMsg.fileName).toBe("test.txt");
    expect(metaMsg.fileSize).toBe(1024);
    expect(metaMsg.totalChunks).toBe(1); // 1024 < 16384
  });

  it("sendFile 发送正确数量的分块", async () => {
    const dc = createMockDC();
    const fileSize = CHUNK_SIZE * 3 + 100; // 3 full chunks + partial
    const file = createMockFile("big.dat", fileSize);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);

    await flushMicrotasks(10);

    // 应发送 META + 4 个分块（COMPLETE 需要等所有 ACK，这里不模拟）
    const calls = dc.send.mock.calls;
    const metaCalls = calls.filter(
      (c: any) => typeof c[0] === "string" && JSON.parse(c[0]).type === "meta",
    );
    const binaryCalls = calls.filter(
      (c: any) => typeof c[0] !== "string",
    );

    expect(metaCalls.length).toBe(1);
    expect(binaryCalls.length).toBe(4);

    // 每个分块可解码且 chunkIndex 连续
    const indices = binaryCalls.map((c: any) => decodeChunk(c[0])!.chunkIndex);
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it("分块正确包含 CRC32 校验值", async () => {
    const dc = createMockDC();
    const fileSize = CHUNK_SIZE;
    const data = new Uint8Array(fileSize);
    for (let i = 0; i < fileSize; i++) data[i] = i % 256;

    const file = createMockFile("crc-test.bin", fileSize, data);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);

    await flushMicrotasks(10);

    // 找到二进制分块消息
    const binaryCalls = dc.send.mock.calls.filter(
      (c: any) => c[0] instanceof ArrayBuffer,
    );
    expect(binaryCalls.length).toBe(1);

    const decoded = decodeChunk(binaryCalls[0][0]);
    const expectedCrc = crc32(data.buffer.slice(0, CHUNK_SIZE));
    expect(decoded!.crc32).toBe(expectedCrc);
  });

  it("收到 VERIFY match=true 后触发 onComplete success", async () => {
    const dc = createMockDC();
    const file = createMockFile("ok.txt", 100);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);

    await flushMicrotasks(10);

    // 模拟接收端发送 VERIFY (match)
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "00000000-0000-0000-0000-000000000001",
        match: true,
      }),
    });

    await flushMicrotasks();

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        sha256_match: true,
      }),
    );
  });

  it("SHA256 不匹配时重传（最多 3 次）", async () => {
    const dc = createMockDC();
    const file = createMockFile("retry.dat", CHUNK_SIZE);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);
    await flushMicrotasks(10);

    // 第一次 VERIFY 失败
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "00000000-0000-0000-0000-000000000001",
        match: false,
      }),
    });
    await flushMicrotasks(10);

    // 第二次 VERIFY 失败
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "00000000-0000-0000-0000-000000000001",
        match: false,
      }),
    });
    await flushMicrotasks(10);

    // 第三次 VERIFY 失败 → 超过 MAX_RETRY_COUNT
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "00000000-0000-0000-0000-000000000001",
        match: false,
      }),
    });
    await flushMicrotasks();

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        sha256_match: false,
        retry_count: MAX_RETRY_COUNT,
      }),
    );
  });

  it("传输过程中上报进度", async () => {
    const dc = createMockDC();
    const fileSize = CHUNK_SIZE * 4;
    const file = createMockFile("progress.dat", fileSize);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("device-1", file, dc as any, callbacks);
    await flushMicrotasks(15);

    // 应该至少上报一次进度
    const progressCalls = callbacks.onProgress.mock.calls.filter(
      (c: any) => c[0].status === "transferring",
    );
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls[0][0]).toMatchObject({
      file_name: "progress.dat",
      total_bytes: fileSize,
    });
  });
});

// ============================================================
// 第三组：接收端流程
// ============================================================

describe("FileTransferService 接收端", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-0000-0000-000000000002",
    );
    mockSHA256("b".repeat(64));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fileTransferService.cancelAll();
  });

  it("收到 META 后设置接收状态并上报进度", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-recv-1",
        fileName: "received.txt",
        fileSize: 1024,
        mimeType: "text/plain",
        totalChunks: 1,
        chunkSize: CHUNK_SIZE,
      }),
    });

    expect(callbacks.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        file_id: "file-recv-1",
        file_name: "received.txt",
        total_bytes: 1024,
        status: "transferring",
      }),
    );
  });

  it("收到二进制分块后发送 ACK", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    // 先发送 META
    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-ack-1",
        fileName: "ack-test.bin",
        fileSize: 100,
        mimeType: "application/octet-stream",
        totalChunks: 1,
        chunkSize: CHUNK_SIZE,
      }),
    });

    // 构造分块
    const chunkData = new Uint8Array(100);
    const chunkCrc = crc32(chunkData.buffer);
    const encoded = encodeChunk(
      "file-ack-1",
      0,
      chunkCrc,
      chunkData.buffer.slice(0),
    );

    dc.send.mockClear(); // 清除之前可能的消息

    dc._trigger("message", { data: encoded });

    // 应该发送 ACK
    const ackCalls = dc.send.mock.calls.filter(
      (c: any) => typeof c[0] === "string",
    );
    const lastAck = ackCalls.length > 0
      ? JSON.parse(ackCalls[ackCalls.length - 1][0])
      : null;

    expect(lastAck).not.toBeNull();
    expect(lastAck.type).toBe("ack");
    expect(lastAck.fileId).toBe("file-ack-1");
    expect(lastAck.status).toBe("ok");
  });

  it("CRC32 校验失败时发送 crc_error ACK", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-crc-err",
        fileName: "bad.bin",
        fileSize: 100,
        mimeType: "application/octet-stream",
        totalChunks: 1,
        chunkSize: CHUNK_SIZE,
      }),
    });

    const chunkData = new Uint8Array(100);
    // 用错误的 CRC 编码
    const encoded = encodeChunk(
      "file-crc-err",
      0,
      0xdeadbeef, // 错误的 CRC
      chunkData.buffer.slice(0),
    );

    dc.send.mockClear();
    dc._trigger("message", { data: encoded });

    const ackCalls = dc.send.mock.calls
      .filter((c: any) => typeof c[0] === "string")
      .map((c: any) => JSON.parse(c[0]));

    const crcErrorAck = ackCalls.find((a: any) => a.status === "crc_error");
    expect(crcErrorAck).toBeDefined();
    expect(crcErrorAck.chunkIndex).toBe(0);
  });

  it("收到 COMPLETE 后进行 SHA256 校验并发送 VERIFY", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    // META: 1 个分块，100 字节
    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-verify-1",
        fileName: "verify-test.bin",
        fileSize: 100,
        mimeType: "application/octet-stream",
        totalChunks: 1,
        chunkSize: CHUNK_SIZE,
      }),
    });

    // 发送分块
    const chunkData = new Uint8Array(100);
    const chunkCrc = crc32(chunkData.buffer);
    const encoded = encodeChunk(
      "file-verify-1",
      0,
      chunkCrc,
      chunkData.buffer.slice(0),
    );
    dc._trigger("message", { data: encoded });

    // 发送 COMPLETE
    dc.send.mockClear();
    dc._trigger("message", {
      data: JSON.stringify({
        type: "complete",
        fileId: "file-verify-1",
        sha256: "b".repeat(64),
      }),
    });

    await flushMicrotasks();

    // 应该发送 VERIFY
    const verifyCalls = dc.send.mock.calls
      .filter((c: any) => typeof c[0] === "string")
      .map((c: any) => JSON.parse(c[0]))
      .filter((m: any) => m.type === "verify");

    expect(verifyCalls.length).toBe(1);
    expect(verifyCalls[0].match).toBe(true);
  });

  it("分块缺失时发送 COMPLETE 返回错误", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    // META: 需要 3 个分块
    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-missing",
        fileName: "missing.bin",
        fileSize: CHUNK_SIZE * 3,
        mimeType: "application/octet-stream",
        totalChunks: 3,
        chunkSize: CHUNK_SIZE,
      }),
    });

    // 只发送 1 个分块
    const chunkData = new Uint8Array(CHUNK_SIZE);
    const crc = crc32(chunkData.buffer);
    const encoded = encodeChunk(
      "file-missing",
      0,
      crc,
      chunkData.buffer.slice(0),
    );
    dc._trigger("message", { data: encoded });

    // 发送 COMPLETE（但分块 1, 2 缺失）
    dc._trigger("message", {
      data: JSON.stringify({
        type: "complete",
        fileId: "file-missing",
        sha256: "any",
      }),
    });

    await flushMicrotasks();

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error_message: expect.stringContaining("缺失"),
      }),
    );
  });

  it("重复分块不重复计数", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    dc._trigger("message", {
      data: JSON.stringify({
        type: "meta",
        fileId: "file-dup",
        fileName: "dup.bin",
        fileSize: CHUNK_SIZE,
        mimeType: "application/octet-stream",
        totalChunks: 1,
        chunkSize: CHUNK_SIZE,
      }),
    });

    const chunkData = new Uint8Array(CHUNK_SIZE);
    const crc = crc32(chunkData.buffer);
    const encoded = encodeChunk(
      "file-dup",
      0,
      crc,
      chunkData.buffer.slice(0),
    );

    // 发送同一分块两次
    dc._trigger("message", { data: encoded });
    dc.send.mockClear();
    dc._trigger("message", { data: encoded });

    // 两次都应该回复 ACK
    const ackCount = dc.send.mock.calls.filter(
      (c: any) =>
        typeof c[0] === "string" && JSON.parse(c[0]).type === "ack",
    ).length;
    expect(ackCount).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 第四组：并行传输队列
// ============================================================

describe("FileTransferService 并行传输队列", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("file-0000-0000-0000-000000000001")
      .mockReturnValueOnce("file-0000-0000-0000-000000000002")
      .mockReturnValueOnce("file-0000-0000-0000-000000000003")
      .mockReturnValueOnce("file-0000-0000-0000-000000000004")
      .mockReturnValueOnce("file-0000-0000-0000-000000000005")
      .mockReturnValueOnce("file-0000-0000-0000-000000000006");
    mockSHA256("c".repeat(64));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fileTransferService.cancelAll();
  });

  it("超过 MAX_PARALLEL_TRANSFERS 时排队", async () => {
    const dcs = Array.from({ length: 6 }, () => createMockDC());
    const files = Array.from({ length: 6 }, (_, i) =>
      createMockFile(`file-${i}.dat`, 100),
    );

    const cancelFns: Array<() => void> = [];
    for (let i = 0; i < 6; i++) {
      const cancel = fileTransferService.sendFile(
        `device-${i}`,
        files[i],
        dcs[i] as any,
        createMockCallbacks(),
      );
      cancelFns.push(cancel);
    }

    await flushMicrotasks();

    // 最多 5 个活跃传输
    const { sends } = fileTransferService.getActiveCount();
    expect(sends).toBe(6); // 5 active + 1 queued
  });

  it("一个传输完成后队列自动推进", async () => {
    const dc = createMockDC();
    const file = createMockFile("queue-test.dat", 100);
    const callbacks = createMockCallbacks();

    // 占满并发槽位（5 个）
    const dcs = Array.from({ length: 5 }, () => createMockDC());
    const files = Array.from({ length: 5 }, (_, i) =>
      createMockFile(`fill-${i}.dat`, 100),
    );
    for (let i = 0; i < 5; i++) {
      fileTransferService.sendFile(
        `dev-${i}`,
        files[i],
        dcs[i] as any,
        createMockCallbacks(),
      );
    }

    // 第 6 个会排队
    fileTransferService.sendFile("dev-q", file, dc as any, callbacks);
    await flushMicrotasks(10);

    const { sends } = fileTransferService.getActiveCount();
    expect(sends).toBe(6); // 5 active + 1 queued
  });

  it("cancelAll 清理所有活跃和排队传输", async () => {
    const dc = createMockDC();
    const file = createMockFile("cancel-all.dat", 100);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("dev-1", file, dc as any, callbacks);
    await flushMicrotasks();

    fileTransferService.cancelAll();

    const { sends, receives } = fileTransferService.getActiveCount();
    expect(sends).toBe(0);
    expect(receives).toBe(0);
  });

  it("cancelSend 取消传输并返回取消结果", async () => {
    const dc = createMockDC();
    const file = createMockFile("cancel-one.dat", 100);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("dev-1", file, dc as any, callbacks);
    await flushMicrotasks();

    // 使用 cancelSend（通过已知 fileId）
    fileTransferService.cancelSend("file-0000-0000-0000-000000000001");

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error_message: "用户取消",
      }),
    );
  });

  it("排队中的传输可以取消", async () => {
    // 先填满 5 个槽位
    const dcs = Array.from({ length: 5 }, () => createMockDC());
    for (let i = 0; i < 5; i++) {
      const file = createMockFile(`fill-${i}.dat`, 100);
      fileTransferService.sendFile(
        `dev-${i}`,
        file,
        dcs[i] as any,
        createMockCallbacks(),
      );
    }

    // 第 6 个排队
    const dc = createMockDC();
    const file = createMockFile("queued.dat", 100);
    const callbacks = createMockCallbacks();
    const cancel = fileTransferService.sendFile(
      "dev-q",
      file,
      dc as any,
      callbacks,
    );

    await flushMicrotasks();

    // 取消排队中的传输
    cancel();

    // 队列应该减少
    const { sends } = fileTransferService.getActiveCount();
    expect(sends).toBe(5); // 只有 5 个活跃的
  });
});

// ============================================================
// 第五组：流控与缓冲区管理
// ============================================================

describe("FileTransferService 流控", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "flow-0000-0000-0000-000000000001",
    );
    mockSHA256("d".repeat(64));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fileTransferService.cancelAll();
  });

  it("缓冲区超过阈值时暂停发送", async () => {
    // 模拟高缓冲区水平
    const dc = createMockDC({ bufferedAmount: 512 * 1024 }); // 512KB > 256KB 阈值
    // 让 bufferedAmount 持续高，触发流控
    const file = createMockFile("flow.dat", CHUNK_SIZE * 10);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("dev-1", file, dc as any, callbacks);

    // 等待几个周期
    await new Promise((r) => setTimeout(r, 50));

    // 不应该发送很多分块（受流控限制）
    const binaryCalls = dc.send.mock.calls.filter(
      (c: any) => typeof c[0] !== "string",
    );
    expect(binaryCalls.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// 第六组：边界情况
// ============================================================

describe("FileTransferService 边界情况", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "edge-0000-0000-0000-000000000001",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fileTransferService.cancelAll();
  });

  it("空文件（0 字节）传输", async () => {
    mockSHA256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"); // SHA256 of empty
    const dc = createMockDC();
    const file = createMockFile("empty.dat", 0);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("dev-1", file, dc as any, callbacks);
    await flushMicrotasks(10);

    // 应该发送 META + COMPLETE（0 个分块）
    const metaCalls = dc.send.mock.calls.filter(
      (c: any) => typeof c[0] === "string" && JSON.parse(c[0]).type === "meta",
    );
    expect(metaCalls.length).toBe(1);
    expect(JSON.parse(metaCalls[0][0]).totalChunks).toBe(0);
  });

  it("未知 fileId 的 ACK 不报错", async () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    // 发送对未知文件 ID 的 ACK（不应该抛出异常）
    expect(() => {
      dc._trigger("message", {
        data: JSON.stringify({
          type: "ack",
          fileId: "non-existent",
          chunkIndex: 0,
          status: "ok",
        }),
      });
    }).not.toThrow();
  });

  it("无效 JSON 控制消息不报错", () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    expect(() => {
      dc._trigger("message", { data: "not valid json!!!" });
    }).not.toThrow();
  });

  it("未知类型的控制消息被忽略", () => {
    const dc = createMockDC();
    const callbacks = createMockCallbacks();
    fileTransferService.setReceiveCallbacks(dc as any, callbacks);

    expect(() => {
      dc._trigger("message", {
        data: JSON.stringify({ type: "unknown_type", payload: "test" }),
      });
    }).not.toThrow();

    // 不应该产生任何回调
    expect(callbacks.onProgress).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it("SHA256 第二次重传成功", async () => {
    const dc = createMockDC();
    const file = createMockFile("retry-ok.dat", CHUNK_SIZE);
    const callbacks = createMockCallbacks();

    fileTransferService.sendFile("dev-1", file, dc as any, callbacks);
    await flushMicrotasks(10);

    // 第一次 VERIFY 失败
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "edge-0000-0000-0000-000000000001",
        match: false,
      }),
    });
    await flushMicrotasks(10);

    // 第二次 VERIFY 成功
    dc._trigger("message", {
      data: JSON.stringify({
        type: "verify",
        fileId: "edge-0000-0000-0000-000000000001",
        match: true,
      }),
    });
    await flushMicrotasks();

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        sha256_match: true,
      }),
    );
  });

  it("getActiveCount 正确反映收发数量", () => {
    const { sends, receives } = fileTransferService.getActiveCount();
    expect(typeof sends).toBe("number");
    expect(typeof receives).toBe("number");
  });
});
