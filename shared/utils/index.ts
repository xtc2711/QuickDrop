// ============================================================
// QuickDrop 共享工具函数
// ============================================================

/**
 * 邮箱格式校验正则
 * 符合 RFC 5322 基本格式
 */
export const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * 校验密码强度: 最少 8 位，必须包含大写字母、小写字母、数字
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("密码长度不能少于 8 位");
  }
  if (password.length > 128) {
    errors.push("密码长度不能超过 128 位");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("密码必须包含至少一个大写字母");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("密码必须包含至少一个小写字母");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("密码必须包含至少一个数字");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验邮箱格式
 */
export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 255;
}

/**
 * 需要排除的弱配对码
 */
export const WEAK_PAIRING_CODES = new Set([
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123456",
  "654321",
  "012345",
  "123123",
  "112233",
  "121212",
]);

/**
 * 生成 6 位随机数字配对码，排除弱密码
 */
export function generatePairingCode(): string {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    if (!WEAK_PAIRING_CODES.has(code)) {
      return code;
    }
  }
  // 兜底：极低概率走到这里
  return "427891";
}

/**
 * 文件传输常量
 */
export const CHUNK_SIZE = 16384; // 16KB
export const MAX_PARALLEL_TRANSFERS = 1; // 单个文件顺序传输
export const MAX_RETRY_COUNT = 3;
export const PAIRING_CODE_TTL_MS = 2 * 60 * 1000; // 2 分钟
export const HEARTBEAT_INTERVAL_MS = 15_000; // 15 秒
export const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 秒超时
export const FLOW_CONTROL_WINDOW = 16; // 流控窗口大小（同时最多在途分块数）
export const BUFFERED_AMOUNT_THRESHOLD = 256 * 1024; // 256KB 缓冲区阈值

// ============================================================
// CRC32 校验 — IEEE 802.3 标准多项式
// 用于每个 16KB 分块的数据完整性校验
// ============================================================

/** CRC-32/IEEE 802.3 查找表（多项式 0xEDB88320） */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

/**
 * 计算 ArrayBuffer 的 CRC32 校验值
 * 与 gzip/PNG/zlib 使用的 CRC-32/IEEE 802.3 一致
 */
export function crc32(data: ArrayBuffer, initialCrc = 0xffffffff): number {
  const view = new Uint8Array(data);
  let crc = initialCrc;
  for (let i = 0; i < view.length; i++) {
    crc = CRC32_TABLE[(crc ^ view[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0; // 转为无符号 32 位
}

/**
 * 流式 CRC32 累积计算
 * 用于分块场景：crc32Concat(prevCrc, nextChunk)
 * prevCrc 需先经过 finalXor（即 crc32 的返回值）
 */
export function crc32Continue(prevResult: number, data: ArrayBuffer): number {
  // 将上次的最终结果还原为中间状态
  const intermediate = (prevResult ^ 0xffffffff) >>> 0;
  return crc32(data, intermediate);
}

// ============================================================
// 增量 SHA256 — 流式哈希计算
// 避免大文件传输时将整个文件加载到内存
// 基于 FIPS 180-4 规范实现
// ============================================================

/** SHA-256 初始哈希值（H⁰₀ – H⁰₇） */
const SHA256_IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** SHA-256 轮常量（K₀ – K₆₃） */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** 32 位循环右移 */
function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * 增量 SHA256 哈希计算器
 *
 * 支持流式 update() 最后 digest() 获取结果的模式，
 * 避免大文件传输时需要将整个文件加载到内存。
 *
 * 使用示例：
 *   const hasher = new IncrementalSHA256();
 *   hasher.update(chunk1);
 *   hasher.update(chunk2);
 *   const hexHash = hasher.digest(); // 64 位十六进制字符串
 */
export class IncrementalSHA256 {
  private state: Uint32Array;
  private buf: Uint8Array;
  private bufLen: number;
  private bytesProcessed: number;

  constructor() {
    this.state = new Uint32Array(SHA256_IV);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.bytesProcessed = 0;
  }

  /** 追加数据到哈希计算 */
  update(data: ArrayBuffer): void {
    const input = new Uint8Array(data);
    let offset = 0;

    this.bytesProcessed += input.length;

    // 先填满内部缓冲区
    if (this.bufLen > 0) {
      const fill = Math.min(64 - this.bufLen, input.length);
      this.buf.set(input.subarray(0, fill), this.bufLen);
      this.bufLen += fill;
      offset += fill;

      if (this.bufLen === 64) {
        this.processBlock(this.buf);
        this.bufLen = 0;
      }
    }

    // 整块处理
    while (offset + 64 <= input.length) {
      this.processBlock(input.subarray(offset, offset + 64));
      offset += 64;
    }

    // 剩余未满 64 字节的存入缓冲区
    if (offset < input.length) {
      this.buf.set(input.subarray(offset), 0);
      this.bufLen = input.length - offset;
    }
  }

  /** 完成哈希，返回十六进制字符串（64 字符） */
  digest(): string {
    // 填充：0x80 + 0x00 直到 ≡ 56 (mod 64) + 64 位大端长度
    const msgLenBits = this.bytesProcessed * 8;
    const finalBuf = new Uint8Array(64);
    finalBuf.set(this.buf.subarray(0, this.bufLen));
    finalBuf[this.bufLen] = 0x80;

    if (this.bufLen >= 56) {
      this.processBlock(finalBuf);
      finalBuf.fill(0, 0, 56);
    }

    const hi = Math.floor(msgLenBits / 0x100000000);
    const lo = msgLenBits >>> 0;
    const view = new DataView(finalBuf.buffer);
    view.setUint32(56, hi, false);
    view.setUint32(60, lo, false);

    this.processBlock(finalBuf);

    // 输出为十六进制字符串
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) {
      outView.setUint32(i * 4, this.state[i], false);
    }

    let hex = "";
    for (let i = 0; i < 32; i++) {
      hex += out[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  /** 处理一个 64 字节的消息块 */
  private processBlock(block: Uint8Array): void {
    // 消息调度 W[0..63]
    const W = new Uint32Array(64);
    const blockView = new DataView(
      block.buffer,
      block.byteOffset,
      block.byteLength,
    );
    for (let t = 0; t < 16; t++) {
      W[t] = blockView.getUint32(t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 =
        rotr32(W[t - 15], 7) ^ rotr32(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 =
        rotr32(W[t - 2], 17) ^ rotr32(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    // 压缩
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

// ============================================================
// 内存监控
// ============================================================

/**
 * 获取当前 JavaScript 堆内存使用量（字节）
 * 仅在支持 performance.memory 的浏览器中可用（Chrome）
 */
export function getHeapMemoryUsage(): {
  used: number;
  total: number;
  limit: number;
  supported: boolean;
} {
  const memory = (performance as unknown as Record<string, unknown>)
    .memory as
    | { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
    | undefined;

  if (!memory) {
    return { used: 0, total: 0, limit: 0, supported: false };
  }

  return {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    limit: memory.jsHeapSizeLimit,
    supported: true,
  };
}

/**
 * 记录内存使用日志（用于传输大文件时监控）
 */
export function logMemoryUsage(label: string): void {
  const mem = getHeapMemoryUsage();
  if (!mem.supported) return;

  const usedMB = (mem.used / 1024 / 1024).toFixed(1);
  const limitMB = (mem.limit / 1024 / 1024).toFixed(0);
  console.log(
    `🧠 [Memory] ${label}: ${usedMB}MB used / ${limitMB}MB limit`,
  );
}

/**
 * 判断文件是否应使用流式传输（> 100MB 使用流式模式）
 * 小文件可以安全地整个加载到内存
 */
export const STREAMING_THRESHOLD = 100 * 1024 * 1024; // 100MB

export function shouldUseStreaming(fileSize: number): boolean {
  return fileSize > STREAMING_THRESHOLD;
}
