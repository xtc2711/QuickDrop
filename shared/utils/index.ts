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
