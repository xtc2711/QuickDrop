// ============================================================
// 认证服务 — 测试环境设置
// Mock Prisma、bcrypt、Redis，避免依赖真实数据库
// ============================================================

import { vi, beforeEach } from "vitest";

// ---------- Mock Prisma Client ----------

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  device: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  refreshToken: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  passwordResetToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// ---------- Mock bcrypt ----------

vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

// ---------- Mock Email Service ----------

vi.mock("../src/services/emailService.js", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
  resetEmailTransporter: vi.fn(),
}));

// ---------- Mock Redis (blacklistService 降级到内存) ----------

vi.mock("../src/utils/redis.js", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
  closeRedis: vi.fn(),
}));

// ---------- 每个测试前重置所有 mock ----------

beforeEach(() => {
  vi.clearAllMocks();
});

// 导出 mock 供测试使用
export { mockPrisma };
