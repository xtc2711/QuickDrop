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
export const MAX_PARALLEL_TRANSFERS = 5;
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
